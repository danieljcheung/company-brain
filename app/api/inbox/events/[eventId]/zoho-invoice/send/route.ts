import { InboxActionType, InboxEventStatus, type Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { databaseUnavailableResponse, getDefaultContext, hasDatabaseUrl } from "../../../../../brain/_shared";
import { requireMutationAuth } from "@/app/lib/apiAuth";
import { externalWritesAllowed, externalWritesBlockedResponse, isSafetyModeActive } from "@/app/lib/integrations/safety";
import {
  fetchZohoInvoiceDetail,
  sendZohoInvoiceEmail,
  updateZohoInvoiceContactPersons,
  type ZohoSentInvoiceEmail,
} from "@/app/lib/integrations/zoho/client";
import { getZohoIntegrationConfig } from "@/app/lib/integrations/zoho/config";
import { getConnectedZohoSession } from "@/app/lib/integrations/zoho/session";
import { createInboxAction } from "@/app/lib/inbox/manualImport";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ eventId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();
  const unauthorized = await requireMutationAuth();
  if (unauthorized) return unauthorized;

  if (await isSafetyModeActive()) {
    return NextResponse.json(
      { error: "External writes are blocked. Toggle Safety Mode to OFF to send the Zoho invoice email." },
      { status: 403 },
    );
  }
  if (!externalWritesAllowed()) {
    return NextResponse.json(externalWritesBlockedResponse("Zoho invoice email send"), { status: 403 });
  }

  const { eventId } = await context.params;
  const { company, reviewer } = await getDefaultContext();
  const event = await prisma.inboxEvent.findFirst({
    where: { id: eventId, companyId: company.id },
  });

  if (!event) {
    return NextResponse.json({ error: "Inbox event was not found." }, { status: 404 });
  }

  const extractedFields = isRecord(event.extractedFields) ? event.extractedFields : {};
  const zohoInvoice = isRecord(extractedFields.zohoInvoice) ? extractedFields.zohoInvoice : null;
  const invoiceId = stringValue(zohoInvoice?.invoiceId);
  if (!invoiceId) {
    return NextResponse.json(
      { error: "Create a Zoho invoice before sending it to the customer." },
      { status: 409 },
    );
  }

  if (!zohoInvoice) {
    return NextResponse.json(
      { error: "Create a Zoho invoice before sending it to the customer." },
      { status: 409 },
    );
  }
  const linkedZohoInvoice = zohoInvoice;
  if (isRecord(linkedZohoInvoice.emailSent)) {
    return NextResponse.json(
      { error: "This Zoho invoice email has already been sent from Company Brain.", zohoInvoice: linkedZohoInvoice },
      { status: 409 },
    );
  }

  let sentInvoiceEmail: ZohoSentInvoiceEmail;
  let organizationId: string;
  try {
    const config = getZohoIntegrationConfig(new URL(request.url).origin);
    const session = await getConnectedZohoSession(config);
    organizationId = session.organizationId;
    const invoiceDetail = await fetchZohoInvoiceDetail({
      config,
      tokenState: session.tokenState,
      organizationId,
      invoiceId,
    });
    const customerId = stringValue(invoiceDetail.customer_id) ?? stringValue(linkedZohoInvoice.customerId);
    const toMailIds = invoiceEmailRecipients(invoiceDetail, extractedFields);
    if (!toMailIds.length) {
      throw new Error("No customer email address was available for this invoice.");
    }
    const contactPersonIds = contactPersonIdsForInvoiceEmail(invoiceDetail);
    if (customerId && contactPersonIds.length) {
      await updateZohoInvoiceContactPersons({
        config,
        tokenState: session.tokenState,
        organizationId,
        invoiceId,
        customerId,
        contactPersonIds,
      });
    }
    sentInvoiceEmail = await sendZohoInvoiceEmail({
      config,
      tokenState: session.tokenState,
      organizationId,
      invoiceId,
      toMailIds,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Zoho invoice email send failed.",
        code: "zoho_request_failed",
        detail: error instanceof Error ? error.message : "Unknown Zoho error.",
      },
      { status: 502 },
    );
  }

  const emailSent = {
    ...sentInvoiceEmail,
    organizationId,
    sentAt: new Date().toISOString(),
    source: "company_brain_inbox_invoice_review",
  };
  const updatedZohoInvoice = {
    ...zohoInvoice,
    emailSent,
  };

  await prisma.$transaction(async (tx) => {
    await tx.inboxEvent.update({
      where: { id: event.id },
      data: {
        status: InboxEventStatus.INVOICED,
        extractedFields: {
          ...extractedFields,
          zohoInvoice: updatedZohoInvoice,
        } as Prisma.InputJsonObject,
        recommendedNextAction: "Zoho invoice emailed to customer through Zoho.",
      },
    });
    await createInboxAction(tx, {
      eventId: event.id,
      actorId: reviewer.id,
      actionType: InboxActionType.STATUS_CHANGED,
      before: { zohoInvoice: linkedZohoInvoice, status: event.status },
      after: { zohoInvoice: updatedZohoInvoice, status: InboxEventStatus.INVOICED },
      note: "Sent the linked Zoho invoice to the customer through Zoho Invoice.",
    });
  });

  return NextResponse.json({ ok: true, status: "invoiced", zohoInvoice: updatedZohoInvoice });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

function invoiceEmailRecipients(
  invoiceDetail: Record<string, unknown>,
  extractedFields: Record<string, unknown>,
) {
  const recipients = new Set<string>();
  const directInvoiceEmail = stringValue(invoiceDetail.email);
  if (directInvoiceEmail) recipients.add(directInvoiceEmail);

  const extractedEmail = stringValue(extractedFields.customerEmail);
  if (extractedEmail) recipients.add(extractedEmail);

  const details = Array.isArray(invoiceDetail.contact_persons_details)
    ? invoiceDetail.contact_persons_details
    : [];
  for (const detail of details) {
    if (!isRecord(detail)) continue;
    const email = stringValue(detail.email);
    if (email) recipients.add(email);
  }

  return [...recipients];
}

function contactPersonIdsForInvoiceEmail(invoiceDetail: Record<string, unknown>) {
  const linked = stringArrayValue(invoiceDetail.contact_persons);
  if (linked.length) return linked;

  const details = Array.isArray(invoiceDetail.contact_persons_details)
    ? invoiceDetail.contact_persons_details
    : [];
  return details
    .filter((detail): detail is Record<string, unknown> => isRecord(detail))
    .filter((detail) => {
      const preference = detail.communication_preference;
      return !isRecord(preference) || preference.is_email_enabled !== false;
    })
    .map((detail) => stringValue(detail.contact_person_id))
    .filter((id): id is string => Boolean(id));
}

function stringArrayValue(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}
