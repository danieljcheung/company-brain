import {
  BrainReviewStatus,
  BrainSection,
  type Prisma,
} from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireMutationAuth } from "@/app/lib/apiAuth";

import {
  buildZohoInvoiceTemplateContext,
  fetchRecentZohoInvoices,
  fetchZohoInvoiceDetail,
} from "@/app/lib/integrations/zoho/client";
import { getZohoIntegrationConfig } from "@/app/lib/integrations/zoho/config";
import { readZohoConnection } from "@/app/lib/integrations/zoho/tokenStore";
import { validZohoTokenState } from "@/app/lib/integrations/zoho/session";
import {
  databaseUnavailableResponse,
  getDefaultContext,
  hasDatabaseUrl,
} from "@/app/api/brain/_shared";
import { prisma } from "@/lib/prisma";

const TEMPLATE_RECORD_TITLE = "Zoho invoice template context";
const WORKFLOW_RECORD_TITLE = "Zoho invoice preview workflow";
const PACKAGE_RULE_RECORD_TITLE = "Zoho package invoicing rules";

export async function POST(request: NextRequest) {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();
  const unauthorized = await requireMutationAuth();
  if (unauthorized) return unauthorized;

  const config = getZohoIntegrationConfig(request.nextUrl.origin);
  const storedConnection = await readZohoConnection();
  if (!config.configured || !storedConnection) {
    return NextResponse.json({ error: "Zoho is not connected." }, { status: 400 });
  }

  const organizationId = config.organizationId || storedConnection.organizationId;
  if (!organizationId) {
    return NextResponse.json({ error: "Zoho organization id is missing." }, { status: 400 });
  }

  const tokenState = await validZohoTokenState({ config, storedConnection });
  const invoiceSummaries = await fetchRecentZohoInvoices({
    config,
    tokenState,
    organizationId,
    limit: 25,
  });
  const invoiceDetails: Record<string, unknown>[] = [];
  for (const invoice of invoiceSummaries.slice(0, 25)) {
    try {
      invoiceDetails.push(
        await fetchZohoInvoiceDetail({
          config,
          tokenState,
          organizationId,
          invoiceId: invoice.invoiceId,
        }),
      );
    } catch {
      // Keep the reusable catalog sync moving when one historical invoice is unavailable.
    }
  }
  const templateContext = buildZohoInvoiceTemplateContext({
    organizationId,
    invoices: invoiceDetails,
  });
  const { company, reviewer } = await getDefaultContext();
  const records = await prisma.$transaction(async (tx) => {
    const template = await upsertApprovedBrainRecord(tx, {
      companyId: company.id,
      reviewerId: reviewer.id,
      section: BrainSection.WORKFLOWS,
      title: TEMPLATE_RECORD_TITLE,
      body: templateBody(templateContext),
      structuredData: templateContext as unknown as Prisma.InputJsonObject,
    });
    const workflow = await upsertApprovedBrainRecord(tx, {
      companyId: company.id,
      reviewerId: reviewer.id,
      section: BrainSection.APPROVAL_RULES,
      title: WORKFLOW_RECORD_TITLE,
      body:
        "Local invoice previews may use Zoho invoice template context from recent invoices, but Zoho invoice creation and Stripe/payment collection require explicit human approval and external writes enabled.",
      structuredData: {
        source: "zoho_recent_invoices",
        requiresHumanApproval: true,
        externalWritesRequired: true,
        createZohoInvoiceAllowedByDefault: false,
      },
    });
    const packageRule = await upsertApprovedBrainRecord(tx, {
      companyId: company.id,
      reviewerId: reviewer.id,
      section: BrainSection.PRICING_RULES,
      title: PACKAGE_RULE_RECORD_TITLE,
      body:
        "Invoice catering as one package line item with quantity 1. Use Tier 1 or Tier 2 package names when confirmed. Orders over 200 cups use a Custom Package. Custom add-ons are listed separately when priced, or included clearly in the package description when a separate price is not known.",
      structuredData: {
        source: "zoho_recent_invoices_and_owner_confirmation",
        billingUnit: "package",
        packageQuantity: 1,
        packageTiers: ["Tier 1", "Tier 2", "Custom Package"],
        customPackageThresholdCups: 200,
        customPackageThresholdRule: "over",
        customAddOns: "separate_line_when_priced",
        recentZohoLineItems: templateContext.lineItemShape as unknown as Prisma.InputJsonValue,
      },
    });
    return { template, workflow, packageRule };
  });

  const payload = {
    ok: true,
    organizationId,
    invoicesFetched: invoiceDetails.length,
    templateContext,
    records: {
      templateRecordId: records.template.id,
      workflowRecordId: records.workflow.id,
      packageRuleRecordId: records.packageRule.id,
    },
  };

  if (request.headers.get("accept")?.includes("text/html")) {
    const redirectUrl = new URL("/settings", request.nextUrl.origin);
    redirectUrl.searchParams.set("zohoTemplateSync", "1");
    redirectUrl.searchParams.set("invoices", String(invoiceDetails.length));
    return NextResponse.redirect(redirectUrl, { status: 303 });
  }

  return NextResponse.json(payload);
}

async function upsertApprovedBrainRecord(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    reviewerId: string;
    section: BrainSection;
    title: string;
    body: string;
    structuredData: Prisma.InputJsonObject;
  },
) {
  const existing = await tx.brainRecord.findFirst({
    where: {
      companyId: input.companyId,
      section: input.section,
      title: input.title,
    },
  });
  if (existing) {
    return tx.brainRecord.update({
      where: { id: existing.id },
      data: {
        body: input.body,
        structuredData: input.structuredData,
        reviewerId: input.reviewerId,
        status: BrainReviewStatus.APPROVED,
        approvedAt: new Date(),
      },
    });
  }

  return tx.brainRecord.create({
    data: {
      companyId: input.companyId,
      section: input.section,
      title: input.title,
      body: input.body,
      structuredData: input.structuredData,
      reviewerId: input.reviewerId,
      status: BrainReviewStatus.APPROVED,
      approvedAt: new Date(),
    },
  });
}

function templateBody(templateContext: ReturnType<typeof buildZohoInvoiceTemplateContext>) {
  const lineShape = templateContext.lineItemShape[0];
  return [
    `Synced from ${templateContext.sampleSize} recent Zoho invoices.`,
    templateContext.templateName
      ? `Primary Zoho template: ${templateContext.templateName}.`
      : "No named Zoho template was returned in the sampled invoice data.",
    templateContext.currencyCode ? `Currency: ${templateContext.currencyCode}.` : null,
    templateContext.paymentTermsLabel
      ? `Payment terms: ${templateContext.paymentTermsLabel}.`
      : null,
    lineShape
      ? `Line items usually include ${lineShape.name ?? "a service item"} with description/rate/quantity fields.`
      : "No reusable line item shape was returned.",
    "Use this as local preview context only until human-approved Zoho creation is enabled.",
  ]
    .filter(Boolean)
    .join(" ");
}
