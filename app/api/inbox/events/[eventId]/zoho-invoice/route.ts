import { InboxActionType, type Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireMutationAuth } from "@/app/lib/apiAuth";

import {
  createZohoContact,
  createZohoInvoice,
  findZohoContactByEmail,
  type ZohoContactSummary,
  type ZohoCreatedInvoice,
  type ZohoCreateInvoiceLineItem,
} from "@/app/lib/integrations/zoho/client";
import { externalWritesAllowed, externalWritesBlockedResponse, isSafetyModeActive } from "@/app/lib/integrations/safety";
import { getZohoIntegrationConfig } from "@/app/lib/integrations/zoho/config";
import { getConnectedZohoSession } from "@/app/lib/integrations/zoho/session";
import { extractEventDetails } from "@/app/lib/inbox/eventDetails";
import {
  applyExactZohoPackageDescription,
  buildLocalInvoicePreview,
  parseMoneyToCents,
} from "@/app/lib/inbox/invoicePreview";
import { createInboxAction } from "@/app/lib/inbox/manualImport";
import { prisma } from "@/lib/prisma";
import {
  databaseUnavailableResponse,
  getDefaultContext,
  hasDatabaseUrl,
} from "../../../../brain/_shared";

type RouteContext = {
  params: Promise<{ eventId: string }>;
};

type CreateZohoInvoiceBody = {
  lineItems?: Array<{
    label?: string;
    description?: string;
    quantity?: number;
    unitPrice?: string;
    amount?: string;
  }>;
  customerId?: string;
  createMissingContact?: boolean;
  contact?: {
    name?: string;
    email?: string;
    companyName?: string;
  };
};

export async function POST(request: NextRequest, context: RouteContext) {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();
  const unauthorized = await requireMutationAuth();
  if (unauthorized) return unauthorized;

  if (await isSafetyModeActive()) {
    return NextResponse.json(
      {
        error:
          "External writes are blocked. Toggle Safety Mode to OFF to create a real Zoho invoice.",
      },
      { status: 403 },
    );
  }
  if (!externalWritesAllowed()) {
    return NextResponse.json(externalWritesBlockedResponse("Zoho invoice creation"), { status: 403 });
  }

  const { eventId } = await context.params;
  const body = await readBody(request);
  const { company, reviewer } = await getDefaultContext();
  const event = await prisma.inboxEvent.findFirst({
    where: { id: eventId, companyId: company.id },
    include: {
      thread: {
        include: {
          messages: {
            orderBy: [{ sentAt: "asc" }, { createdAt: "asc" }],
          },
        },
      },
    },
  });

  if (!event) {
    return NextResponse.json({ error: "Inbox event was not found." }, { status: 404 });
  }

  const extractedFields = isRecord(event.extractedFields) ? event.extractedFields : {};
  if (isRecord(extractedFields.zohoInvoice) && extractedFields.zohoInvoice.invoiceId) {
    return NextResponse.json(
      {
        error: "A Zoho invoice is already linked to this inbox event.",
        zohoInvoice: extractedFields.zohoInvoice,
      },
      { status: 409 },
    );
  }

  const eventDetails = extractEventDetails({
    persistedFields: event.extractedFields,
    fallbackCustomerName: stringValue(extractedFields.customerName) ?? undefined,
    fallbackCustomerEmail: stringValue(extractedFields.customerEmail),
    messages: event.thread.messages.map((message) => ({
      id: message.id,
      author: addressLabel(message.from),
      fromEmail: addressEmail(message.from),
      isCustomer: !isPopupPearlSender(message.from),
      body: message.bodyPlain ?? message.snippet ?? "",
    })),
  });
  const preview = buildLocalInvoicePreview({
    eventId: event.id,
    eventDetails,
    extractedFields: event.extractedFields,
  });
  if (!preview) {
    return NextResponse.json(
      { error: "This inbox event does not have an invoice-ready local preview." },
      { status: 400 },
    );
  }

  const customerEmail =
    stringValue(extractedFields.customerEmail) ??
    eventDetails.fields.find((field) => field.key === "customerEmail")?.value ??
    null;
  const customerName =
    stringValue(extractedFields.customerName) ??
    eventDetails.fields.find((field) => field.key === "customerName")?.value ??
    "Popup Pearl customer";
  const customerCompany = stringValue(body.contact?.companyName);
  let contact: ZohoContactSummary | null = null;
  let createdInvoice: ZohoCreatedInvoice;
  let organizationId: string;

  try {
    const config = getZohoIntegrationConfig(request.nextUrl.origin);
    const session = await getConnectedZohoSession(config);
    organizationId = session.organizationId;
    const { tokenState } = session;

    contact = body.customerId
      ? { contactId: body.customerId, contactName: customerName, email: customerEmail, contactPersonId: null }
      : customerEmail
        ? await findZohoContactByEmail({
            config,
            tokenState,
            organizationId,
            email: customerEmail,
          })
        : null;

    if (!contact) {
      const previewContact = {
        name: stringValue(body.contact?.name) ?? customerName,
        email: stringValue(body.contact?.email) ?? customerEmail,
        companyName: customerCompany,
      };
      if (body.createMissingContact && previewContact.email) {
        contact = await createZohoContact({
          config,
          tokenState,
          organizationId,
          contact: {
            contactName: previewContact.name,
            email: previewContact.email,
            companyName: previewContact.companyName,
          },
        });
      } else {
        return NextResponse.json(
          {
            error:
              customerEmail
                ? `No existing Zoho contact found for ${customerEmail}. Review the customer preview, then create the Zoho contact.`
                : "No customer email was extracted. Add a customer email before creating a Zoho contact or invoice.",
            code: "missing_contact",
            customerPreview: previewContact,
          },
          { status: 409 },
        );
      }
    }

    if (!contact) {
      return NextResponse.json(
        {
          error: "Could not create or resolve a Zoho contact for this invoice.",
        },
        { status: 409 },
      );
    }

    const templateContext = await latestZohoTemplateContext(company.id);
    const exactPreview = applyExactZohoPackageDescription(
      preview,
      templateLineItems(templateContext?.lineItemShape),
    );
    createdInvoice = await createZohoInvoice({
      config,
      tokenState,
      organizationId,
      customerId: contact.contactId,
      date: new Date().toISOString().slice(0, 10),
      templateId: stringValue(templateContext?.templateId),
      paymentTerms: stringValue(templateContext?.paymentTermsLabel),
      notes: stringValue(templateContext?.notes),
      contactPersonIds: contact.contactPersonId ? [contact.contactPersonId] : undefined,
      terms: stringValue(templateContext?.terms),
      referenceNumber: event.thread.gmailThreadId,
      lineItems: invoiceLineItemsFromBody(body, exactPreview),
    });
  } catch (error) {
    return zohoRouteErrorResponse(error);
  }

  const zohoInvoice = {
    ...createdInvoice,
    customerId: contact.contactId,
    customerName: contact.contactName,
    customerCreated: Boolean(body.createMissingContact && !body.customerId),
    organizationId,
    createdAt: new Date().toISOString(),
    source: "company_brain_inbox_invoice_preview",
  };
  await prisma.$transaction(async (tx) => {
    await tx.inboxEvent.update({
      where: { id: event.id },
      data: {
        extractedFields: {
          ...extractedFields,
          zohoInvoice,
        } as Prisma.InputJsonObject,
        recommendedNextAction:
          "Zoho invoice created. Review it in Zoho before sending or collecting payment.",
      },
    });
    await createInboxAction(tx, {
      eventId: event.id,
      actorId: reviewer.id,
      actionType: InboxActionType.STATUS_CHANGED,
      before: { zohoInvoice: null },
      after: { zohoInvoice },
      note: "Created Zoho invoice from the local editable invoice preview. No email send or Stripe/payment collection occurred.",
    });
  });

  return NextResponse.json({ ok: true, zohoInvoice });
}

function zohoRouteErrorResponse(error: unknown) {
  return NextResponse.json(
    {
      error: "Zoho invoice creation failed.",
      code: "zoho_request_failed",
      detail: error instanceof Error ? error.message : "Unknown Zoho error.",
    },
    { status: 502 },
  );
}

async function readBody(request: NextRequest): Promise<CreateZohoInvoiceBody> {
  const text = await request.text();
  if (!text.trim()) return {};
  return JSON.parse(text) as CreateZohoInvoiceBody;
}

function invoiceLineItemsFromBody(
  body: CreateZohoInvoiceBody,
  preview: NonNullable<ReturnType<typeof buildLocalInvoicePreview>>,
): ZohoCreateInvoiceLineItem[] {
  const source = body.lineItems?.length ? body.lineItems : preview.lineItems;
  return source.map((line) => {
    const quantity = Math.max(1, Number(line.quantity) || 1);
    const unitPriceCents = parseMoneyToCents(line.unitPrice) ?? 0;
    return {
      name: line.label?.trim() || "Popup Pearl catering",
      description: line.description?.trim() || line.label?.trim() || "Popup Pearl catering",
      quantity,
      rate: unitPriceCents / 100,
    };
  });
}

async function latestZohoTemplateContext(companyId: string) {
  const record = await prisma.brainRecord.findFirst({
    where: {
      companyId,
      title: "Zoho invoice template context",
    },
    orderBy: { updatedAt: "desc" },
  });
  return isRecord(record?.structuredData) ? record.structuredData : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

function templateLineItems(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((line) => ({
    name: stringValue(line.name),
    description: stringValue(line.description),
    rate: typeof line.rate === "number" && Number.isFinite(line.rate) ? line.rate : null,
  }));
}

function addressLabel(value: unknown) {
  if (!isRecord(value)) return "Unknown sender";
  return stringValue(value.name) ?? stringValue(value.email) ?? "Unknown sender";
}

function addressEmail(value: unknown) {
  return isRecord(value) ? stringValue(value.email) : null;
}

function isPopupPearlSender(value: unknown) {
  const text = `${addressLabel(value)} ${addressEmail(value) ?? ""}`.toLowerCase();
  if (text.includes("wordpress") || text.includes("wix") || text.includes("no-reply") || text.includes("noreply") || text.includes("website")) {
    return false;
  }
  return text.includes("popuppearl.ca") || text.includes("popup pearl");
}
