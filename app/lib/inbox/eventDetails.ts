export type EventDetailFieldKey =
  | "customerName"
  | "customerEmail"
  | "eventDate"
  | "serviceWindow"
  | "startTime"
  | "location"
  | "quantityOrGuestCount"
  | "service"
  | "tierPackage"
  | "size"
  | "flavours"
  | "toppings"
  | "stickerLogoRequest"
  | "customAddOns"
  | "specialNotes"
  | "roughTotalPrice"
  | "attachmentsSummary";

export type EventDetailField = {
  key: EventDetailFieldKey;
  label: string;
  value: string;
  confidence: number;
  sourceMessageId: string;
  sourceSnippet: string;
  source: "persisted" | "deterministic";
};

export type InvoiceReadiness = {
  ready: boolean;
  hints: string[];
};

export type EventDetailsExtraction = {
  fields: EventDetailField[];
  missingFields: string[];
  invoiceReadiness: InvoiceReadiness;
};

export type EventDetailsMessage = {
  id: string;
  body: string;
  author?: string;
  fromEmail?: string | null;
  isCustomer?: boolean;
  attachments?: Array<{
    filename: string;
    mimeType?: string | null;
    sizeBytes?: number | null;
  }>;
};

export type PersistedEventDetailsMetadata = {
  sourceSubject: string;
  classificationReason?: string;
  extractedAt?: string;
};

const fieldLabels: Record<EventDetailFieldKey, string> = {
  customerName: "Customer name",
  customerEmail: "Customer email",
  eventDate: "Event date",
  serviceWindow: "Time / service window",
  startTime: "Start time",
  location: "Location",
  quantityOrGuestCount: "Guest count / quantity",
  service: "Service",
  tierPackage: "Package / tier",
  size: "Size",
  flavours: "Flavours / selections",
  toppings: "Toppings",
  stickerLogoRequest: "Sticker / logo",
  customAddOns: "Custom add-ons",
  specialNotes: "Special notes",
  roughTotalPrice: "Price",
  attachmentsSummary: "Attachments",
};

const persistedKeyMap: Array<[EventDetailFieldKey, string[]]> = [
  ["customerName", ["customerName", "name"]],
  ["customerEmail", ["customerEmail", "email"]],
  ["eventDate", ["eventDate"]],
  ["serviceWindow", ["serviceWindow", "timeWindow", "time"]],
  ["startTime", ["startTime"]],
  ["location", ["location", "address", "venue"]],
  ["quantityOrGuestCount", ["quantityOrGuestCount", "guestCount", "quantity", "headcount"]],
  ["service", ["service"]],
  ["tierPackage", ["tierPackage", "package", "tier"]],
  ["size", ["size"]],
  ["flavours", ["flavours", "flavors", "selections"]],
  ["toppings", ["toppings"]],
  ["stickerLogoRequest", ["stickerLogoRequest", "stickerLogo", "logoRequest"]],
  ["customAddOns", ["customAddOns", "addOns", "addons"]],
  ["specialNotes", ["specialNotes", "comments", "notes", "setupConstraints"]],
  ["roughTotalPrice", ["roughTotalPrice", "quotedPrice", "totalPrice", "price", "quoteTotal"]],
  ["attachmentsSummary", ["attachmentsSummary", "attachments"]],
];

const requiredForQuote: EventDetailFieldKey[] = [
  "customerName",
  "customerEmail",
  "eventDate",
  "serviceWindow",
  "location",
  "quantityOrGuestCount",
  "service",
  "flavours",
];

const requiredForInvoice: EventDetailFieldKey[] = [
  "customerName",
  "customerEmail",
  "eventDate",
  "serviceWindow",
  "location",
  "quantityOrGuestCount",
  "service",
  "flavours",
  "roughTotalPrice",
];

export function extractEventDetails(input: {
  messages: EventDetailsMessage[];
  persistedFields?: unknown;
  fallbackCustomerName?: string;
  fallbackCustomerEmail?: string | null;
  requireQuoteDetails?: boolean;
}): EventDetailsExtraction {
  const fields = new Map<EventDetailFieldKey, EventDetailField>();
  const firstCustomerMessage =
    input.messages.find((message) => message.isCustomer) ?? input.messages[0];

  addPersistedFields(fields, input.persistedFields);

  if (!fields.has("customerName") && input.fallbackCustomerName) {
    addField(fields, {
      key: "customerName",
      value: input.fallbackCustomerName,
      sourceMessageId: firstCustomerMessage?.id ?? "thread",
      sourceSnippet: firstCustomerMessage?.author ?? "Sender",
      confidence: 0.9,
      source: "deterministic",
    });
  }

  if (!fields.has("customerEmail") && input.fallbackCustomerEmail) {
    addField(fields, {
      key: "customerEmail",
      value: input.fallbackCustomerEmail,
      sourceMessageId: firstCustomerMessage?.id ?? "thread",
      sourceSnippet: input.fallbackCustomerEmail,
      confidence: 0.95,
      source: "deterministic",
    });
  }

  for (const message of input.messages) {
    extractFromMessage(fields, message);
  }
  normalizeServiceWindowFromStartTime(fields);


  addAttachmentSummary(fields, input.messages);

  const fieldList = Array.from(fields.values());
  const requireQuoteDetails = input.requireQuoteDetails ?? true;
  const missingFields = requireQuoteDetails
    ? requiredForQuote
        .filter((key) => !hasRequiredField(fields, key))
        .map((key) => fieldLabels[key])
    : [];
  const invoiceMissing = requiredForInvoice.filter((key) => !hasRequiredField(fields, key));
  const invoiceIntentPresent = hasCustomerInvoiceAcceptance(input.messages);
  const invoiceBlockers = requireQuoteDetails
    ? [
        ...invoiceMissing.map((key) => `Needs ${fieldLabels[key].toLowerCase()}`),
        ...(invoiceIntentPresent
          ? []
          : ["Needs clear customer acceptance of Popup Pearl's offer to send an invoice."]),
      ]
    : ["Not an active quote or invoice thread."];
  const invoiceReadiness = {
    ready: requireQuoteDetails && invoiceMissing.length === 0 && invoiceIntentPresent,
    hints: invoiceBlockers.length
      ? invoiceBlockers
      : ["All invoice fields are present and the customer clearly accepted Popup Pearl's invoice offer. Human review still required before any send or Stripe write."],
  };

  return { fields: fieldList, missingFields, invoiceReadiness };
}

export function serializeEventDetailsExtraction(
  extraction: EventDetailsExtraction,
  metadata: PersistedEventDetailsMetadata,
) {
  const values: Record<EventDetailFieldKey, string | string[] | null> = {
    customerName: null,
    customerEmail: null,
    eventDate: null,
    serviceWindow: null,
    startTime: null,
    location: null,
    quantityOrGuestCount: null,
    service: null,
    tierPackage: null,
    size: null,
    flavours: [],
    toppings: [],
    stickerLogoRequest: null,
    customAddOns: null,
    specialNotes: null,
    roughTotalPrice: null,
    attachmentsSummary: null,
  };

  for (const field of extraction.fields) {
    values[field.key] = field.value;
  }

  const fields = extraction.fields.map((field) => ({
    key: field.key,
    label: field.label,
    value: field.value,
    confidence: field.confidence,
    sourceMessageId: field.sourceMessageId,
    sourceSnippet: field.sourceSnippet,
    source: field.source,
  }));

  return {
    ...values,
    missingFields: extraction.missingFields,
    invoiceReadiness: extraction.invoiceReadiness,
    invoiceReady: extraction.invoiceReadiness.ready,
    invoiceReadinessHints: extraction.invoiceReadiness.hints,
    fields,
    fieldEvidence: fields,
    sourceSubject: metadata.sourceSubject,
    classificationReason: metadata.classificationReason,
    extractionMethod: "deterministic_event_details_v1",
    extractedAt: metadata.extractedAt ?? new Date().toISOString(),
  };
}

function addPersistedFields(
  fields: Map<EventDetailFieldKey, EventDetailField>,
  persistedFields: unknown,
) {
  if (!isRecord(persistedFields)) return;
  const sourceSubject = stringValue(persistedFields.sourceSubject) ?? "Persisted extraction";

  for (const [key, aliases] of persistedKeyMap) {
    for (const alias of aliases) {
      const value = displayValue(persistedFields[alias]);
      if (!value) continue;
      addField(fields, {
        key,
        value,
        sourceMessageId: "persisted",
        sourceSnippet: sourceSubject,
        confidence: 0.96,
        source: "persisted",
      });
      break;
    }
  }
}

function extractFromMessage(
  fields: Map<EventDetailFieldKey, EventDetailField>,
  message: EventDetailsMessage,
) {
  const text = normalizeText(message.body);
  if (!text) return;

  matchField(fields, message, "eventDate", text, [
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?\b/i,
    /\b\d{4}-\d{1,2}-\d{1,2}\b/,
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
  ]);
  matchField(fields, message, "serviceWindow", text, [
    /\b(?:between|from)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+(?:to|-|and)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i,
    /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*(?:-|to)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i,
    /\b(?:delivery|pickup|setup|service)\s+(?:at|by|for|window)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i,
  ]);
  matchField(fields, message, "startTime", text, [
    /\b(?:start time|starts?|begin(?:s)?|service starts?)\s*:\s*([^\n.]{2,60})/i,
    /\b(?:starts?|begin(?:s)?|service starts?)\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i,
  ]);
  matchField(fields, message, "location", text, [
    /\b(?:address|location|venue|event location)\s*:\s*([^\n.]{6,120})/i,
    /\b\d{1,6}\s+[A-Za-z0-9 .'-]{3,80}\s+(?:st|street|ave|avenue|rd|road|blvd|drive|dr|lane|ln|court|ct|crescent|cres)\b[^\n.]*/i,
  ]);
  matchField(fields, message, "quantityOrGuestCount", text, [
    /\b(?:for|around|approx(?:imately)?|about|estimated?|expect(?:ing)?)\s+\d{1,4}\s*(?:guests?|people|students?|attendees?|drinks?|cups?|servings?)\b/i,
    /\b\d{1,4}\s*(?:guests?|people|students?|attendees?|drinks?|cups?|servings?)\b/i,
  ]);
  matchField(fields, message, "roughTotalPrice", text, [
    /\b(?:total|price|quote|quoted|roughly|estimate|estimated)\s*(?:is|at|of|:)?\s*\$[\d,]+(?:\.\d{2})?\b/i,
    /\$[\d,]+(?:\.\d{2})?\s*(?:total|all in|plus tax|before tax)?\b/i,
  ]);
  matchKeywordField(fields, message, "service", text, [
    "bubble tea catering",
    "bubble tea",
    "milk tea",
    "matcha",
    "pop-up",
    "popup",
    "catering",
    "drink service",
  ]);
  matchField(fields, message, "tierPackage", text, [
    /\b(?:package|tier)\s*:\s*([^\n.]{3,80})/i,
    /\b(?:classic|premium|standard|deluxe|custom)\s+(?:package|tier)\b/i,
  ]);
  matchField(fields, message, "size", text, [
    /\b(?:size|cup size)\s*:\s*([^\n.]{2,60})/i,
    /\b(?:small|medium|large|regular)\s+(?:cups?|drinks?)\b/i,
    /\b\d{1,2}\s*oz\b/i,
  ]);
  matchListField(fields, message, "flavours", text, [
    /\b(?:flavou?rs?|selections?|drinks?)\s*:\s*([^\n.]{3,160})/i,
    /\b(?:classic milk tea|brown sugar|taro|matcha|strawberry|mango|thai tea|jasmine|oolong)\b(?:[^.\n]{0,120})/i,
  ]);
  matchListField(fields, message, "toppings", text, [
    /\b(?:toppings?|pearls?|boba)\s*:\s*([^\n.]{3,160})/i,
    /\b(?:tapioca|pearls|boba|grass jelly|pudding|lychee jelly|cheese foam)\b(?:[^.\n]{0,120})/i,
  ]);
  matchField(fields, message, "stickerLogoRequest", text, [
    /\b(?:sticker|stickers|logo|label|labels|branded)\b[^.\n]{0,140}/i,
  ]);
  matchField(fields, message, "customAddOns", text, [
    /\b(?:custom|add-?on|extra|delivery|setup|table|cups?|straws?)\b[^.\n]{0,140}/i,
  ]);
  matchField(fields, message, "specialNotes", text, [
    /\b(?:note|notes|comments?|allerg(?:y|ies)|dietary|important)\s*:\s*([^\n.]{3,180})/i,
    /\b(?:allerg(?:y|ies)|dietary restrictions?|nut[- ]free|vegan|halal)\b[^.\n]{0,140}/i,
  ]);
}

function addAttachmentSummary(
  fields: Map<EventDetailFieldKey, EventDetailField>,
  messages: EventDetailsMessage[],
) {
  if (fields.has("attachmentsSummary")) return;
  const attachments = messages.flatMap((message) =>
    (message.attachments ?? []).map((attachment) => attachment.filename).filter(Boolean),
  );
  if (!attachments.length) return;
  const message =
    messages.find((item) => item.attachments?.length) ?? messages.find((item) => item.isCustomer) ?? messages[0];
  addField(fields, {
    key: "attachmentsSummary",
    value: attachments.join(", "),
    sourceMessageId: message?.id ?? "thread",
    sourceSnippet: attachments.slice(0, 3).join(", "),
    confidence: 0.95,
    source: "deterministic",
  });
}

function normalizeServiceWindowFromStartTime(fields: Map<EventDetailFieldKey, EventDetailField>) {
  if (fields.has("serviceWindow")) return;
  const startTime = fields.get("startTime");
  if (!startTime) return;
  addField(fields, {
    key: "serviceWindow",
    value: startTime.value,
    sourceMessageId: startTime.sourceMessageId,
    sourceSnippet: startTime.sourceSnippet,
    confidence: startTime.confidence,
    source: startTime.source,
  });
}

function hasRequiredField(
  fields: Map<EventDetailFieldKey, EventDetailField>,
  key: EventDetailFieldKey,
) {
  if (key === "serviceWindow") return fields.has("serviceWindow") || fields.has("startTime");
  return fields.has(key);
}

function hasCustomerInvoiceAcceptance(messages: EventDetailsMessage[]) {
  return messages
    .filter((message) => message.isCustomer)
    .some((message) =>
      /\b(send (?:the )?invoice|ready for (?:the )?invoice|invoice me|please invoice|you can invoice|go ahead (?:and )?(?:send|issue) (?:the )?invoice|proceed with (?:the )?invoice|move forward with (?:the )?invoice|yes[, ]+(?:please )?(?:send|issue) (?:the )?invoice)\b/i.test(
        message.body,
      ),
    );
}

function matchField(
  fields: Map<EventDetailFieldKey, EventDetailField>,
  message: EventDetailsMessage,
  key: EventDetailFieldKey,
  text: string,
  patterns: RegExp[],
) {
  if (fields.has(key)) return;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = cleanValue(match?.[1] ?? match?.[0]);
    if (!value) continue;
    addField(fields, fieldFromMessage(message, key, value, text));
    return;
  }
}

function matchKeywordField(
  fields: Map<EventDetailFieldKey, EventDetailField>,
  message: EventDetailsMessage,
  key: EventDetailFieldKey,
  text: string,
  keywords: string[],
) {
  if (fields.has(key)) return;
  const lower = text.toLowerCase();
  const keyword = keywords.find((item) => lower.includes(item));
  if (!keyword) return;
  addField(fields, fieldFromMessage(message, key, titleCase(keyword), text));
}

function matchListField(
  fields: Map<EventDetailFieldKey, EventDetailField>,
  message: EventDetailsMessage,
  key: EventDetailFieldKey,
  text: string,
  patterns: RegExp[],
) {
  matchField(fields, message, key, text, patterns);
}

function fieldFromMessage(
  message: EventDetailsMessage,
  key: EventDetailFieldKey,
  value: string,
  text: string,
): EventDetailField {
  return {
    key,
    label: fieldLabels[key],
    value,
    confidence: 0.82,
    sourceMessageId: message.id,
    sourceSnippet: snippetAround(text, value),
    source: "deterministic",
  };
}

function addField(
  fields: Map<EventDetailFieldKey, EventDetailField>,
  field: Omit<EventDetailField, "label">,
) {
  if (!field.value.trim() || fields.has(field.key)) return;
  fields.set(field.key, {
    ...field,
    label: fieldLabels[field.key],
    value: field.value.trim(),
  });
}

function snippetAround(text: string, value: string) {
  const normalized = normalizeText(text);
  const index = normalized.toLowerCase().indexOf(value.toLowerCase());
  if (index === -1) return normalized.slice(0, 180);
  return normalized.slice(Math.max(0, index - 60), index + value.length + 80).trim();
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function cleanValue(value: string | undefined) {
  return value
    ?.replace(/^[:\s-]+/, "")
    .replace(/\s+/g, " ")
    .replace(/[,.]$/, "")
    .trim();
}

function displayValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    const items = value.map((item) => stringValue(item)).filter(Boolean);
    return items.length ? items.join(", ") : null;
  }

  return stringValue(value);
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text || text.toLowerCase() === "null") return null;
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
