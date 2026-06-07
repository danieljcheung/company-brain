import type { EventDetailsExtraction } from "./eventDetails";
import type { InvoicePreview } from "../mockData";

type BuildInvoicePreviewInput = {
  eventId: string;
  eventDetails: EventDetailsExtraction;
  extractedFields?: unknown;
};

export type ZohoTemplateLineItem = {
  name?: string | null;
  description?: string | null;
  rate?: number | null;
};

const currencyFormatter = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
});

export function buildLocalInvoicePreview(
  input: BuildInvoicePreviewInput,
): InvoicePreview | undefined {
  if (!input.eventDetails.invoiceReadiness.ready) return undefined;
  const agentPreview = invoicePreviewFromAgentLineItems(input.extractedFields, input.eventId);
  if (agentPreview) return agentPreview;

  const invoicePreview = invoicePreviewFromPersistedFields(input.extractedFields);
  if (invoicePreview) return invoicePreview;

  const total = detailValue(input.eventDetails, "roughTotalPrice");
  if (!total) return undefined;

  const totalCents = parseMoneyToCents(total);
  const cupCount = parseQuantity(detailValue(input.eventDetails, "quantityOrGuestCount"));
  const tierPackage = detailValue(input.eventDetails, "tierPackage");
  const customAddOns = detailValue(input.eventDetails, "customAddOns");
  const flavours = detailValue(input.eventDetails, "flavours");
  const toppings = detailValue(input.eventDetails, "toppings");
  const packageLabel = packageName(tierPackage, cupCount);
  const packageDescription = canonicalPackageDescription({
    cupCount,
    tier: packageTier(packageLabel),
    flavourCount: flavours ? countSelections(flavours) : null,
    toppingCount: toppings ? countSelections(toppings) : null,
    customAddOns,
  });

  return {
    id: `local-preview-${input.eventId}`,
    status: "preview",
    lineItems: [
      {
        label: packageLabel,
        description: packageDescription,
        quantity: 1,
        unitPrice: totalCents ? formatMoneyCents(totalCents) : total,
        amount: totalCents ? formatMoneyCents(totalCents) : total,
      },
    ],
    total: totalCents ? formatMoneyCents(totalCents) : total,
    approvalGate:
      "Local Zoho-style preview only. Review and edit before creating anything in Zoho or Stripe.",
  };
}

function packageName(tierPackage: string | null, cupCount: number | null) {
  if (cupCount && cupCount > 200) return `Custom Package - ${cupCount} cups, 9oz - Bubble Tea`;
  if (tierPackage && /\btier\s*2\b/i.test(tierPackage)) {
    return cupCount ? `Tier 2 Package ${cupCount} cups - Bubble Tea` : "Tier 2 Package";
  }
  if (tierPackage && /\btier\s*1\b/i.test(tierPackage)) {
    return cupCount ? `Tier 1 Package - ${cupCount} cups, 9oz - Bubble Tea` : "Tier 1 Package";
  }
  if (tierPackage) return tierPackage;
  return cupCount
    ? `Popup Pearl Package - ${cupCount} cups, 9oz - Bubble Tea`
    : "Popup Pearl Package";
}

function countSelections(value: string) {
  return value.split(/,|\/|\band\b/i).filter((item) => item.trim()).length;
}

function canonicalPackageDescription(input: {
  cupCount: number | null;
  tier: ReturnType<typeof packageTier>;
  flavourCount: number | null;
  toppingCount: number | null;
  customAddOns: string | null;
}) {
  const cupCount = input.cupCount ?? "Custom";
  const flavourCount = input.flavourCount ?? 2;
  const toppingCount = input.toppingCount ?? 3;
  const base =
    input.tier === "tier_2"
      ? [
          `${cupCount}, 9oz cups`,
          `${flavourCount} flavours, ${toppingCount} toppings`,
          "Custom stickers ",
          "White Popup Pearl stand",
          "2 hours of live barista service",
        ]
      : [
          `${cupCount}, 9oz cups`,
          "2 hours of live barista service",
          `${flavourCount} flavours `,
          `${toppingCount} toppings`,
          "Standard Popup Pearl stand",
        ];

  if (input.customAddOns) base.push(input.customAddOns);
  return base.join("\n");
}

function invoicePreviewFromAgentLineItems(
  value: unknown,
  eventId: string,
): InvoicePreview | undefined {
  if (!isRecord(value) || !Array.isArray(value.invoiceLineItems)) return undefined;
  const lineItems = value.invoiceLineItems.filter(isRecord).flatMap((line) => {
    const quantity = numberValue(line.quantity) ?? 1;
    const unitPrice = stringValue(line.unitPrice) ?? stringValue(line.amount);
    const amount = stringValue(line.amount) ?? unitPrice;
    const label = stringValue(line.label);
    if (!label || !unitPrice || !amount) return [];
    return [
      {
        label,
        description: stringValue(line.description) ?? undefined,
        quantity: Math.max(1, quantity),
        unitPrice,
        amount,
      },
    ];
  });

  if (!lineItems.length) return undefined;

  return {
    id: `agent-preview-${eventId}`,
    status: "preview",
    lineItems,
    total: formatMoneyCents(
      lineItems.reduce((sum, line) => {
        const amount = parseMoneyToCents(line.amount);
        if (amount !== null) return sum + amount;
        const unitPrice = parseMoneyToCents(line.unitPrice);
        return sum + (unitPrice ?? 0) * line.quantity;
      }, 0),
    ),
    approvalGate:
      "Agent-generated Zoho-style preview only. Review and edit before creating anything in Zoho or Stripe.",
  };
}


export function applyExactZohoPackageDescription(
  preview: InvoicePreview,
  templateLineItems: ZohoTemplateLineItem[] | undefined,
) {
  if (!templateLineItems?.length || preview.lineItems.length !== 1) return preview;
  const line = preview.lineItems[0];
  const sourceText = `${line.label}\n${line.description ?? ""}`;
  const cupCount = parseCupCount(sourceText);
  const sourceCupSize = parseCupSize(sourceText);
  const tier = packageTier(line.label);
  if (!cupCount || !tier) return preview;

  const match = templateLineItems.find((candidate) => {
    const name = candidate.name ?? "";
    const description = candidate.description ?? "";
    const candidateText = `${name}\n${description}`;
    const candidateCupSize = parseCupSize(candidateText);
    return (
      parseCupCount(candidateText) === cupCount &&
      packageTier(name) === tier &&
      (!sourceCupSize || !candidateCupSize || sourceCupSize === candidateCupSize)
    );
  });
  if (!match?.name) return preview;

  const rate = typeof match.rate === "number" && Number.isFinite(match.rate) ? match.rate : null;
  const unitPrice = rate === null ? line.unitPrice : formatMoneyCents(Math.round(rate * 100));
  return {
    ...preview,
    lineItems: [
      {
        ...line,
        label: match.name,
        description: match.description ?? line.description,
        unitPrice,
        amount: rate === null ? line.amount : formatMoneyCents(Math.round(rate * 100) * line.quantity),
      },
    ],
    total: rate === null ? preview.total : formatMoneyCents(Math.round(rate * 100) * line.quantity),
  };
}

export function parseMoneyToCents(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.replace(/,/g, "").match(/-?\d+(?:\.\d{1,2})?/);
  if (!normalized) return null;
  return Math.round(Number(normalized[0]) * 100);
}

export function formatMoneyCents(value: number) {
  return currencyFormatter.format(value / 100);
}

function detailValue(
  eventDetails: EventDetailsExtraction,
  key: EventDetailsExtraction["fields"][number]["key"],
) {
  return eventDetails.fields.find((field) => field.key === key)?.value.trim() || null;
}

function parseQuantity(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/\d+/);
  if (!match) return null;
  const quantity = Number(match[0]);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

function parseCupCount(value: string | null | undefined) {
  if (!value) return null;
  const match =
    value.match(/\b(\d+)\s*(?:cups?|drinks?)\b/i) ??
    value.match(/\b(?:cups?|drinks?)\D{0,12}(\d+)\b/i);
  if (!match) return null;
  const quantity = Number(match[1]);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

function parseCupSize(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/\b(9|12)\s*oz\b/i);
  return match ? `${match[1]}oz` : null;
}

function packageTier(value: string) {
  if (/\btier\s*1\b/i.test(value)) return "tier_1";
  if (/\btier\s*2\b/i.test(value)) return "tier_2";
  if (/\bcustom package\b/i.test(value)) return "custom";
  return null;
}

function invoicePreviewFromPersistedFields(value: unknown): InvoicePreview | undefined {
  if (!isRecord(value) || !isRecord(value.invoicePreview)) return undefined;

  const preview = value.invoicePreview;
  const lineItems = Array.isArray(preview.lineItems)
    ? preview.lineItems
        .filter(isRecord)
        .map((line) => ({
          label: stringValue(line.label) ?? "Popup Pearl catering",
          description: stringValue(line.description) ?? undefined,
          quantity: numberValue(line.quantity) ?? 1,
          unitPrice: stringValue(line.unitPrice) ?? stringValue(line.amount) ?? "$0.00",
          amount: stringValue(line.amount) ?? "$0.00",
        }))
    : [];

  if (!lineItems.length) return undefined;

  const quantityOrGuestCount = stringValue(value.quantityOrGuestCount);
  const cupCount = parseQuantity(quantityOrGuestCount);
  const tierPackage = stringValue(value.tierPackage);
  const normalizedLineItems =
    lineItems.length === 1 && lineItems[0].quantity > 1
      ? [
          {
            ...lineItems[0],
            label: packageName(tierPackage, cupCount),
            quantity: 1,
            unitPrice: lineItems[0].amount,
          },
        ]
      : lineItems;

  return {
    id: stringValue(preview.id) ?? "local-preview",
    status: preview.status === "approved_mock" || preview.status === "blocked" ? preview.status : "preview",
    lineItems: normalizedLineItems,
    total:
      stringValue(preview.total) ??
      formatMoneyCents(
        normalizedLineItems.reduce((sum, line) => sum + (parseMoneyToCents(line.amount) ?? 0), 0),
      ),
    approvalGate:
      stringValue(preview.approvalGate) ??
      "Local Zoho-style preview only. Review and edit before creating anything in Zoho or Stripe.",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
