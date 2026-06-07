import type { Prisma } from "@prisma/client";

import {
  extractEventDetails,
  serializeEventDetailsExtraction,
  type EventDetailsMessage,
} from "./eventDetails";
import type { MockThreadInput } from "./manualImport";
import { isVisibleInboxAttachment } from "./visibleAttachments";

export type InboxAiThreadCategory =
  | "customer_inquiry"
  | "customer_followup"
  | "marketing"
  | "vendor"
  | "internal"
  | "unrelated"
  | "manual_review";

export type InboxAiExtractedFields = {
  customerName: string | null;
  customerEmail: string | null;
  eventDate: string | null;
  serviceWindow: string | null;
  startTime: string | null;
  location: string | null;
  quantityOrGuestCount: string | null;
  service: string | null;
  tierPackage: string | null;
  size: string | null;
  flavours: string | null;
  selections: string | null;
  toppings: string | null;
  stickerLogoRequest: string | null;
  customAddOns: string | null;
  specialNotes: string | null;
  comments: string | null;
  roughTotalPrice: string | null;
  quotedPrice: string | null;
  attachmentsSummary: string | null;
};

export type InboxAiInvoiceLineItem = {
  label: string;
  description: string | null;
  quantity: number;
  unitPrice: string;
  amount: string;
};

export type InboxAiFieldEvidence = {
  field: keyof InboxAiExtractedFields;
  value: string | null;
  sourceMessageId: string | null;
  sourceSnippet: string | null;
  confidence: number;
};

export type InboxAiBrainRecord = {
  id: string;
  section: string;
  sectionLabel: string;
  title: string;
  bodyExcerpt: string;
  structuredDataExcerpt: string | null;
  provenanceSummary: string | null;
};

export type InboxAiBrainRecordEvidence = {
  id: string;
  rationale: string;
};

export type InboxAiThreadTitle = {
  title: string;
  rationale: string;
};

export type InboxAiAgentResult = {
  threadTitle: InboxAiThreadTitle;
  threadCategory: InboxAiThreadCategory;
  extractedFields: InboxAiExtractedFields;
  fieldEvidence: InboxAiFieldEvidence[];
  missingFields: string[];
  invoiceReadiness: {
    ready: boolean;
    reason: string;
    blockers: string[];
  };
  invoiceLineItems: InboxAiInvoiceLineItem[];
  recommendedNextAction: string;
  draft: {
    subject: string;
    body: string;
    asksCustomerToConfirm: boolean;
  };
  brainRecordEvidence: InboxAiBrainRecordEvidence[];
  warnings: string[];
};

export type InboxAiMessage = {
  id: string;
  gmailMessageId?: string;
  author?: string;
  fromEmail?: string | null;
  isCustomer: boolean;
  subject?: string | null;
  body: string;
  sentAt?: string | null;
  attachments?: Array<{
    id?: string;
    filename: string;
    mimeType?: string | null;
    sizeBytes?: number | null;
  }>;
};

export type InboxAiAgentInput = {
  subject: string;
  messages: InboxAiMessage[];
  deterministicExtractedFields?: unknown;
  regenerationRequest?: string;
  previousDraftBody?: string | null;
  attachmentsSummary?: string;
  latestCustomerMessage?: InboxAiMessage | null;
  toneExamples?: InboxAiMessage[];
  approvedBrainRecords?: InboxAiBrainRecord[];
  isFollowUp?: boolean;
};

export type InboxAiCallMetadata = {
  model: string;
  method: "openai_responses_api";
  generatedAt: string;
  confidence: number;
};

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const POPUP_PEARL_FORM_FIELDS: Array<keyof InboxAiExtractedFields> = [
  "customerName",
  "customerEmail",
  "eventDate",
  "serviceWindow",
  "startTime",
  "location",
  "quantityOrGuestCount",
  "service",
  "tierPackage",
  "size",
  "flavours",
  "selections",
  "toppings",
  "stickerLogoRequest",
  "customAddOns",
  "specialNotes",
  "comments",
  "roughTotalPrice",
  "quotedPrice",
  "attachmentsSummary",
];

const FIELD_LABELS: Record<keyof InboxAiExtractedFields, string> = {
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
  selections: "Selections",
  toppings: "Toppings",
  stickerLogoRequest: "Sticker / logo",
  customAddOns: "Custom add-ons",
  specialNotes: "Special notes / comments",
  comments: "Comments",
  roughTotalPrice: "Price",
  quotedPrice: "Quoted price",
  attachmentsSummary: "Attachments",
};

const PRIMARY_DISPLAY_FIELDS: Array<keyof InboxAiExtractedFields> = [
  "customerName",
  "customerEmail",
  "eventDate",
  "serviceWindow",
  "startTime",
  "location",
  "quantityOrGuestCount",
  "service",
  "tierPackage",
  "size",
  "flavours",
  "toppings",
  "stickerLogoRequest",
  "customAddOns",
  "specialNotes",
  "roughTotalPrice",
  "attachmentsSummary",
];

export function hasOpenAIInboxAgent() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function openAIInboxModel() {
  return process.env.OPENAI_INBOX_MODEL || process.env.OPENAI_MODEL || "gpt-5.5";
}

export async function analyzeInboxThreadWithOpenAI(
  input: InboxAiAgentInput,
): Promise<{ result: InboxAiAgentResult; metadata: InboxAiCallMetadata }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const model = openAIInboxModel();
  const response = await fetchWithTimeout(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        {
          role: "developer",
          content: inboxAgentInstructions(input.isFollowUp),
        },
        {
          role: "user",
          content: JSON.stringify(compactAgentInput(input)),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "popup_pearl_inbox_agent_payload",
          strict: true,
          schema: inboxAgentSchema(),
        },
      },
    }),
  });

  const data = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(openAIErrorMessage(data, response.status));
  }

  const outputText = extractOutputText(data);
  if (!outputText) throw new Error("OpenAI response did not include output text.");

  const result = normalizeAgentResult(JSON.parse(outputText) as InboxAiAgentResult);
  return {
    result,
    metadata: {
      model,
      method: "openai_responses_api",
      generatedAt: new Date().toISOString(),
      confidence: averageConfidence(result.fieldEvidence),
    },
  };
}

export function threadInputForInboxAgent(
  thread: MockThreadInput,
  options: {
    deterministicExtractedFields?: unknown;
    approvedBrainRecords?: InboxAiBrainRecord[];
  } = {},
): InboxAiAgentInput {
  const messages = thread.messages.map<InboxAiMessage>((message) => ({
    id: message.gmailMessageId,
    gmailMessageId: message.gmailMessageId,
    author: addressLabel(message.from),
    fromEmail: message.from?.email ?? null,
    isCustomer: !isPopupPearlAddress(message.from) || isNewBookingRequestNotification(message),
    subject: message.subject ?? thread.subject,
    body: messageText(message),
    sentAt: dateString(message.sentAt ?? message.internalDate),
    attachments: message.attachments?.filter(isVisibleInboxAttachment).map((attachment) => ({
      id: attachment.gmailAttachmentId,
      filename: attachment.filename,
      mimeType: attachment.mimeType ?? null,
      sizeBytes: attachment.sizeBytes ?? null,
    })),
  }));

  return {
    subject: thread.subject,
    messages,
    deterministicExtractedFields: options.deterministicExtractedFields,
    approvedBrainRecords: options.approvedBrainRecords,
    attachmentsSummary: summarizeAttachments(messages),
    latestCustomerMessage: latestCustomerMessage(messages),
    toneExamples: messages.filter((message) => !message.isCustomer).slice(-5),
  };
}

export async function buildOpenAIExtractedFieldsForThread(input: {
  thread: MockThreadInput;
  classificationReason: string;
  extractedAt?: Date;
  approvedBrainRecords?: InboxAiBrainRecord[];
}) {
  const now = input.extractedAt ?? new Date();
  const deterministic = deterministicSerializedExtraction(input.thread, {
    classificationReason: input.classificationReason,
    extractedAt: now,
  });

  if (!hasOpenAIInboxAgent()) return { extractedFields: deterministic, aiError: null };

  try {
    const { result, metadata } = await analyzeInboxThreadWithOpenAI(
      threadInputForInboxAgent(input.thread, {
        deterministicExtractedFields: deterministic,
        approvedBrainRecords: input.approvedBrainRecords,
      }),
    );

    return {
      extractedFields: serializeOpenAIInboxExtraction(result, metadata, {
        sourceSubject: input.thread.subject,
        classificationReason: input.classificationReason,
      }),
      aiError: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenAI Inbox extraction failed.";
    return {
      extractedFields: {
        ...deterministic,
        aiExtractionAttempted: true,
        aiExtractionError: message,
      } as Prisma.InputJsonObject,
      aiError: message,
    };
  }
}

export function deterministicSerializedExtraction(
  thread: MockThreadInput,
  input: { classificationReason: string; extractedAt: Date },
) {
  const customerMessage = thread.messages.find((message) => !isPopupPearlAddress(message.from) || isNewBookingRequestNotification(message));
  const quoteDetailsRequired = deterministicRequiresQuoteDetails(thread);
  const threadCategory: InboxAiThreadCategory = quoteDetailsRequired
    ? "customer_inquiry"
    : "customer_followup";
  const extraction = extractEventDetails({
    fallbackCustomerName: customerMessage?.from?.name,
    fallbackCustomerEmail: customerMessage?.from?.email,
    requireQuoteDetails: quoteDetailsRequired,
    messages: thread.messages.map<EventDetailsMessage>((message) => ({
      id: message.gmailMessageId,
      author: addressLabel(message.from),
      fromEmail: message.from?.email ?? null,
      isCustomer: !isPopupPearlAddress(message.from) || isNewBookingRequestNotification(message),
      body: messageText(message),
      attachments: message.attachments?.filter(isVisibleInboxAttachment).map((attachment) => ({
        filename: attachment.filename,
        mimeType: attachment.mimeType ?? null,
        sizeBytes: attachment.sizeBytes ?? null,
      })),
    })),
  });

  return {
    ...serializeEventDetailsExtraction(extraction, {
    sourceSubject: thread.subject,
    classificationReason: input.classificationReason,
    extractedAt: input.extractedAt.toISOString(),
    }),
    threadCategory,
    requiresQuoteDetails: quoteDetailsRequired,
    recommendedNextAction: recommendedNextActionForCategory(threadCategory),
  } as Prisma.InputJsonObject;
}

export function serializeOpenAIInboxExtraction(
  result: InboxAiAgentResult,
  metadata: InboxAiCallMetadata,
  input: { sourceSubject: string; classificationReason?: string },
) {
  const values = Object.fromEntries(
    POPUP_PEARL_FORM_FIELDS.map((field) => [field, result.extractedFields[field] ?? null]),
  ) as Record<keyof InboxAiExtractedFields, string | null>;

  const fields = PRIMARY_DISPLAY_FIELDS.map((key) => {
    const value = values[key];
    if (!value) return null;
    const evidence = result.fieldEvidence.find((item) => item.field === key);
    return {
      key,
      label: FIELD_LABELS[key],
      value,
      confidence: clampConfidence(evidence?.confidence ?? metadata.confidence),
      sourceMessageId: evidence?.sourceMessageId ?? "openai",
      sourceSnippet: evidence?.sourceSnippet ?? FIELD_LABELS[key],
      source: "openai",
    };
  }).filter(Boolean);

  const quoteDetailsRequired = requiresQuoteDetails(result.threadCategory);
  const invoiceReadiness = quoteDetailsRequired
    ? guardedInvoiceReadiness(result, values)
    : {
        ready: false,
        reason: "Not an active quote or invoice thread.",
        blockers: ["Not an active quote or invoice thread."],
        hints: ["Not an active quote or invoice thread."],
      };
  const threadTitle = normalizeThreadTitle(result.threadTitle, values, input.sourceSubject);
  const invoiceLineItems = normalizeInvoiceLineItems(result.invoiceLineItems);

  return {
    ...values,
    invoicePreview: invoicePreviewFromAgentLineItems(invoiceLineItems, metadata.generatedAt),
    invoiceLineItems,
    missingFields: quoteDetailsRequired ? result.missingFields : [],
    invoiceReadiness,
    invoiceReady: invoiceReadiness.ready,
    invoiceReadinessHints: invoiceReadiness.hints,
    threadTitle,
    fields,
    fieldEvidence: result.fieldEvidence,
    threadCategory: result.threadCategory,
    requiresQuoteDetails: quoteDetailsRequired,
    recommendedNextAction: result.recommendedNextAction,
    draft: result.draft,
    brainRecordEvidence: result.brainRecordEvidence,
    warnings: result.warnings,
    sourceSubject: input.sourceSubject,
    classificationReason: input.classificationReason,
    extractionMethod: "openai_responses_api_inbox_agent_v1",
    aiModel: metadata.model,
    aiMethod: metadata.method,
    aiConfidence: metadata.confidence,
    extractedAt: metadata.generatedAt,
  } as Prisma.InputJsonObject;
}

function guardedInvoiceReadiness(
  result: InboxAiAgentResult,
  values: Record<keyof InboxAiExtractedFields, string | null>,
) {
  const requiredInvoiceFields: Array<[string, string | null]> = [
    ["Customer name", values.customerName],
    ["Customer email", values.customerEmail],
    ["Event date", values.eventDate],
    ["Time / service window", values.serviceWindow ?? values.startTime],
    ["Location", values.location],
    ["Guest count / quantity", values.quantityOrGuestCount],
    ["Service", values.service],
    ["Flavours / selections", values.flavours ?? values.selections],
    ["Price", values.roughTotalPrice ?? values.quotedPrice],
  ];
  const missingCoreFields = requiredInvoiceFields
    .filter(([, value]) => !value)
    .map(([label]) => `Needs ${label.toLowerCase()}`);
  const modelBlockers = result.invoiceReadiness.blockers;
  const blockers = [...missingCoreFields, ...modelBlockers];
  const ready =
    result.invoiceReadiness.ready &&
    result.missingFields.length === 0 &&
    blockers.length === 0;
  const reason = ready
    ? "All invoice fields are present and the customer clearly accepted Popup Pearl's invoice offer."
    : result.invoiceReadiness.reason;

  return {
    ready,
    reason,
    blockers,
    hints: blockers.length ? blockers : [reason],
  };
}

function normalizeThreadTitle(
  threadTitle: InboxAiThreadTitle,
  values: Record<keyof InboxAiExtractedFields, string | null>,
  fallbackSubject: string,
) {
  const title = threadTitle.title.trim();
  if (title) {
    return {
      title: title.slice(0, 120),
      rationale: threadTitle.rationale.trim().slice(0, 300) || "Generated by inbox agent.",
      source: "openai_responses_api_inbox_agent_v1",
    };
  }

  return {
    title: fallbackThreadTitle(values, fallbackSubject),
    rationale: "Fallback title assembled from extracted event fields.",
    source: "local_fallback",
  };
}

function fallbackThreadTitle(
  values: Record<keyof InboxAiExtractedFields, string | null>,
  fallbackSubject: string,
) {
  const parts = [
    values.eventDate,
    values.quantityOrGuestCount,
    values.tierPackage,
    values.customerName,
    values.service,
  ].filter((value): value is string => Boolean(value?.trim()));
  return (parts.length ? parts.join(" - ") : fallbackSubject || "Inbox thread").slice(0, 120);
}

function inboxAgentInstructions(isFollowUp?: boolean) {
  return [
    "You are the local-only Popup Pearl Inbox agent.",
    "Return exactly one JSON object matching the schema. Do not include markdown.",
    "Primary goal: accurate quotes and reducing manual work.",
    "Classify the whole thread, including customer inquiries/followups, marketing, vendor, internal, unrelated, and manual-review cases.",
    "Read messages chronologically and treat later customer corrections as authoritative. If a customer says 'instead of X', 'swap X for Y', or later lists final choices, remove the superseded earlier choice from extracted fields, selections, toppings, invoiceLineItems, and draft wording.",
    "When the latest customer selection says 'we will go with A, B, and C', use exactly those final choices unless a later message changes them. Do not carry forward earlier tentative recommendations or previously selected options that were replaced.",
    "When invoice readiness is true, include invoiceLineItems that exactly reflect the accepted pricing evidence. Prefer the customer's accepted quoted package/add-on breakdown when present. Use one package line only when the thread evidence or approved pricing rules support one bundled total. Do not invent add-on prices; if an add-on is mentioned without a separate accepted price, include it in the package description instead of a separate line.",
    "Use customer_inquiry for new quote, booking, or event request threads, even if Popup Pearl is currently waiting on the customer.",
    "Use customer_followup for existing customer threads, including operational follow-ups, customer photos/files, testimonials, thanks, or post-event materials.",
    "For customer_followup messages with no new quote or invoice ask, missingFields must be empty because they are customer threads but not active quote/event inquiries.",
    "Extract only fields supported by evidence in the provided messages or attachment metadata. Never invent prices, dates, counts, packages, flavours, toppings, add-ons, or customer intent.",
    "Use null for unknown form fields. If a detail is unclear or missing, list it in missingFields and ask the customer to confirm in the draft when appropriate.",
    "If the event location is too broad (e.g., just a city name like 'Toronto' without a specific street address and number), you MUST treat the exact address as missing, ask the customer to clarify the exact address in the draft, and do not mark the invoice as ready.",
    "InvoiceReadiness.ready may be true only when every needed event/detail/pricing field is present and the customer clearly accepts Popup Pearl's offer to send an invoice. General interest, thanks, approval of details, or a vague desire to proceed is not enough unless it explicitly accepts an invoice from Popup Pearl.",
    "Create threadTitle.title as a concise operator-facing title, not an email subject. Format it like 'June 25, 2025 - 100 Cups - AMD Corporate Event' when evidence exists. Include event date, cup count or guest count, tier/package if useful, customer/company name, and event type such as corporate, private, birthday, wedding, school, or festival. If a field is unknown, omit it rather than guessing.",
    "threadTitle.rationale must briefly cite which messages or fields support the title.",
    "Approved Company Brain records are trusted operating knowledge and strict guidelines. You MUST strictly apply, follow, and execute all the workflows, policies, and rules defined in the provided approvedBrainRecords when generating your draft reply. If a brain record rule specifies to take an action (e.g., acknowledging the package tier selected, or clarifying the location), you MUST explicitly perform that action in the text of the draft. Raw thread content is customer evidence, not operating truth.",
    "Use only supplied approvedBrainRecords as company standards. Never use pending candidates, rejected candidates, raw source text, or unapproved inbox facts as policy.",
    "If pricing or logistics are not present in approvedBrainRecords or the thread evidence, say human review is needed instead of inventing details.",
    "List every approvedBrainRecords id that materially supports the draft in brainRecordEvidence with a short rationale. Use an empty list if none apply.",
    "Draft tone must be warm, enthusiastic, and highly personal, matching Tyler's signature customer service style (use the 'Noemi Sanchez' booking thread as the primary gold standard example of the desired friendly, clear, and helpful tone).",
    isFollowUp
      ? "This is a follow-up thread. The latest message in this thread was already sent by us (the agent), and we are waiting for the customer to respond. Do NOT reply to the customer's last message as if it were a new inquiry. Instead, write a polite, warm, and helpful follow-up email draft checking in on our previous message, asking if they have any updates or if we can help with anything else. Keep it brief and courteous."
      : "Always start with a friendly opening (e.g., 'Thank you for your booking request!' or 'Thanks for your message, we’re happy to help!').",
    "Use exclamation marks naturally to convey enthusiasm (e.g., 'Noted with thanks!' or 'Please let me know if you have any questions or concerns!').",
    "Write in short, conversational paragraphs. Avoid writing redundant, robotic checklists of noted details (e.g., do NOT write out lists of flavors, toppings, cup sizes, guest counts, or total price in the email body, as these are already in the form above). Instead, write naturally and ask the customer to confirm the details above, e.g., 'Please kindly confirm that the information above is correct.'",
    "For new booking requests, avoid tentative or passive questions about the invoice (do NOT write 'let me know if you'd like us to prepare the invoice' or 'let me know if you would like me to prepare the invoice'). Instead, state the onboarding next steps clearly and directly: 'Once we receive your confirmation, we will forward an invoice with the deposit details.'",
    "Always close and sign off the draft using this exact format: 'Kind regards,\\nTyler'.",
    "Never use em-dashes (—) or en-dashes (–) in the draft body. Use standard punctuation like commas, periods, or semicolons instead.",
    "Never sign off as 'Popup Pearl', 'The Popup Pearl Team', 'Best', or 'Thanks'. Never mention AI, schemas, or internal systems.",
    "No Gmail sends, Gmail drafts, labels, modifies, or external writes are allowed. This is only a local extraction and local draft suggestion.",
    "When quoting customer text in evidence snippets, keep snippets short and only use text present in the input.",
  ].join("\n");
}

function inboxAgentSchema() {
  const nullableString = { type: ["string", "null"] };
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "threadTitle",
      "threadCategory",
      "extractedFields",
      "fieldEvidence",
      "missingFields",
      "invoiceLineItems",
      "invoiceReadiness",
      "recommendedNextAction",
      "draft",
      "brainRecordEvidence",
      "warnings",
    ],
    properties: {
      threadTitle: {
        type: "object",
        additionalProperties: false,
        required: ["title", "rationale"],
        properties: {
          title: { type: "string" },
          rationale: { type: "string" },
        },
      },
      threadCategory: {
        type: "string",
        enum: [
          "customer_inquiry",
          "customer_followup",
          "marketing",
          "vendor",
          "internal",
          "unrelated",
          "manual_review",
        ],
      },
      extractedFields: {
        type: "object",
        additionalProperties: false,
        required: POPUP_PEARL_FORM_FIELDS,
        properties: Object.fromEntries(
          POPUP_PEARL_FORM_FIELDS.map((field) => [field, nullableString]),
        ),
      },
      fieldEvidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["field", "value", "sourceMessageId", "sourceSnippet", "confidence"],
          properties: {
            field: { type: "string", enum: POPUP_PEARL_FORM_FIELDS },
            value: nullableString,
            sourceMessageId: nullableString,
            sourceSnippet: nullableString,
            confidence: { type: "number" },
          },
        },
      },
      missingFields: { type: "array", items: { type: "string" } },
      invoiceLineItems: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "description", "quantity", "unitPrice", "amount"],
          properties: {
            label: { type: "string" },
            description: nullableString,
            quantity: { type: "number" },
            unitPrice: { type: "string" },
            amount: { type: "string" },
          },
        },
      },
      invoiceReadiness: {
        type: "object",
        additionalProperties: false,
        required: ["ready", "reason", "blockers"],
        properties: {
          ready: { type: "boolean" },
          reason: { type: "string" },
          blockers: { type: "array", items: { type: "string" } },
        },
      },
      recommendedNextAction: { type: "string" },
      draft: {
        type: "object",
        additionalProperties: false,
        required: ["subject", "body", "asksCustomerToConfirm"],
        properties: {
          subject: { type: "string" },
          body: { type: "string" },
          asksCustomerToConfirm: { type: "boolean" },
        },
      },
      brainRecordEvidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "rationale"],
          properties: {
            id: { type: "string" },
            rationale: { type: "string" },
          },
        },
      },
      warnings: { type: "array", items: { type: "string" } },
    },
  };
}

function deterministicRequiresQuoteDetails(thread: MockThreadInput) {
  const text = [
    thread.subject,
    ...thread.messages.flatMap((message) => [
      message.subject,
      message.snippet,
      message.bodyPlain,
      message.bodyHtml,
      ...(message.attachments ?? []).filter(isVisibleInboxAttachment).map((attachment) => attachment.filename),
    ]),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  const hasMediaMarker = /\b(photo|photos|picture|pictures|image|images|attached|attachment|file|files)\b/.test(text);
  const hasPastEventMarker = /\b(last week|yesterday|recent event|asian heritage|photo i took|here is a photo|thanks|thank you)\b/.test(text);
  const hasActiveBookingMarker = /\b(book|booking|quote|invoice|event date|guests?|location|flavou?rs?|catering|private event)\b/.test(text);
  const hasThankYouMarker = /\b(thank you|thanks|gratitude|grateful|appreciation|appreciate|successful event|professionalism|partnership|support)\b/.test(text);
  const hasQuestionOrAsk = /\?|please (send|share|confirm|quote|invoice|book)|can you|could you|would you|looking to|interested in|availability\b/.test(text);

  if (hasActiveBookingMarker) return true;
  if (hasMediaMarker && hasPastEventMarker) return false;
  if (hasThankYouMarker && !hasQuestionOrAsk) return false;
  return true;
}

function requiresQuoteDetails(category: InboxAiThreadCategory | string | null | undefined) {
  return category === "customer_inquiry";
}

function recommendedNextActionForCategory(category: InboxAiThreadCategory) {
  if (category === "customer_inquiry") {
    return "Review the new inquiry and respond based on the latest customer message.";
  }
  return "Review the customer follow-up and respond if needed.";
}

function compactAgentInput(input: InboxAiAgentInput) {
  return {
    isFollowUp: input.isFollowUp ?? null,
    subject: input.subject,
    approvedBrainRecords: (input.approvedBrainRecords ?? []).map((record) => ({
      id: record.id,
      section: record.section,
      sectionLabel: record.sectionLabel,
      title: record.title,
      bodyExcerpt: truncate(cleanText(record.bodyExcerpt), 700),
      structuredDataExcerpt: record.structuredDataExcerpt
        ? truncate(cleanText(record.structuredDataExcerpt), 500)
        : null,
      provenanceSummary: record.provenanceSummary,
    })),
    deterministicExtractedFields: input.deterministicExtractedFields ?? null,
    regenerationRequest: input.regenerationRequest ?? null,
    previousDraftBody: input.previousDraftBody ? truncate(cleanText(input.previousDraftBody), 1200) : null,
    attachmentsSummary: input.attachmentsSummary ?? summarizeAttachments(input.messages),
    latestCustomerMessage: input.latestCustomerMessage
      ? compactMessage(input.latestCustomerMessage, 1600)
      : null,
    previousPopupPearlToneExamples: (input.toneExamples ?? [])
      .filter((message) => !message.isCustomer)
      .slice(-5)
      .map((message) => compactMessage(message, 1200)),
    messages: input.messages.map((message) => compactMessage(message, 2200)),
  };
}

function compactMessage(message: InboxAiMessage, limit: number) {
  return {
    id: message.id,
    gmailMessageId: message.gmailMessageId ?? message.id,
    author: message.author,
    fromEmail: message.fromEmail,
    isCustomer: message.isCustomer,
    subject: message.subject,
    sentAt: message.sentAt,
    body: truncate(cleanText(message.body), limit),
    attachments: message.attachments ?? [],
  };
}

function normalizeAgentResult(result: InboxAiAgentResult): InboxAiAgentResult {
  return {
    ...result,
    extractedFields: Object.fromEntries(
      POPUP_PEARL_FORM_FIELDS.map((field) => [
        field,
        stringOrNull(result.extractedFields?.[field]),
      ]),
    ) as InboxAiExtractedFields,
    fieldEvidence: (result.fieldEvidence ?? [])
      .filter((item) => POPUP_PEARL_FORM_FIELDS.includes(item.field))
      .map((item) => ({
        field: item.field,
        value: stringOrNull(item.value),
        sourceMessageId: stringOrNull(item.sourceMessageId),
        sourceSnippet: item.sourceSnippet ? truncate(cleanText(item.sourceSnippet), 240) : null,
        confidence: clampConfidence(item.confidence),
      })),
    missingFields: stringArray(result.missingFields),
    brainRecordEvidence: (result.brainRecordEvidence ?? [])
      .map((item) => ({
        id: stringOrNull(item.id),
        rationale: stringOrNull(item.rationale),
      }))
      .filter((item): item is InboxAiBrainRecordEvidence => Boolean(item.id && item.rationale)),
    invoiceReadiness: {
      ready: Boolean(result.invoiceReadiness?.ready),
      reason: String(result.invoiceReadiness?.reason || "Human review required."),
      blockers: stringArray(result.invoiceReadiness?.blockers),
    },
    invoiceLineItems: normalizeInvoiceLineItems(result.invoiceLineItems),
    recommendedNextAction: String(result.recommendedNextAction || "Review the thread manually."),
    draft: {
      subject: String(result.draft?.subject || "Re: Popup Pearl inquiry"),
      body: String(result.draft?.body || ""),
      asksCustomerToConfirm: Boolean(result.draft?.asksCustomerToConfirm),
    },
    warnings: stringArray(result.warnings),
  };
}

function extractOutputText(value: unknown): string | null {
  if (isRecord(value) && typeof value.output_text === "string") return value.output_text;
  if (!isRecord(value) || !Array.isArray(value.output)) return null;

  const parts: string[] = [];
  for (const item of value.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && typeof content.text === "string") parts.push(content.text);
    }
  }

  return parts.join("").trim() || null;
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function openAIErrorMessage(value: unknown, status: number) {
  if (isRecord(value) && isRecord(value.error) && typeof value.error.message === "string") {
    return `OpenAI Inbox agent failed (${status}): ${value.error.message}`;
  }
  return `OpenAI Inbox agent failed with HTTP ${status}.`;
}

function averageConfidence(evidence: InboxAiFieldEvidence[]) {
  const scores = evidence
    .map((item) => clampConfidence(item.confidence))
    .filter((score) => Number.isFinite(score));
  if (!scores.length) return 0.5;
  return Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2));
}

function clampConfidence(value: unknown) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : 0.5;
  return Math.max(0, Math.min(1, Number(number.toFixed(2))));
}

function latestCustomerMessage(messages: InboxAiMessage[]) {
  return messages
    .filter((message) => message.isCustomer)
    .sort((a, b) => Date.parse(b.sentAt ?? "") - Date.parse(a.sentAt ?? ""))[0] ?? null;
}

function summarizeAttachments(messages: InboxAiMessage[]) {
  const attachments = messages.flatMap((message) =>
    (message.attachments ?? []).map((attachment) => attachment.filename),
  );
  return attachments.length ? attachments.join(", ") : "No attachments.";
}

function messageText(input: MockThreadInput["messages"][number]) {
  return [input.subject, input.snippet, input.bodyPlain ?? stripHtml(input.bodyHtml ?? "")]
    .filter(Boolean)
    .join("\n");
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function addressLabel(address?: { name?: string; email?: string }) {
  return address?.name || address?.email || "Unknown sender";
}

function isPopupPearlAddress(address?: { name?: string; email?: string }) {
  const text = `${address?.name ?? ""} ${address?.email ?? ""}`.toLowerCase();
  if (text.includes("wordpress") || text.includes("no-reply") || text.includes("noreply") || text.includes("website")) {
    return false;
  }
  return text.includes("popuppearl.ca") || text.includes("popup pearl");
}

export function isNewBookingRequestNotification(message?: {
  subject?: string | null;
  bodyPlain?: string | null;
  snippet?: string | null;
  bodyHtml?: string | null;
}) {
  if (!message) return false;
  const subject = (message.subject ?? "").toLowerCase();
  const snippet = (message.snippet ?? "").toLowerCase();
  const body = (message.bodyPlain ?? "").toLowerCase();
  const html = (message.bodyHtml ?? "").toLowerCase();
  return (
    subject.includes("new booking request from:") ||
    snippet.includes("new booking request from:") ||
    body.includes("new booking request from:") ||
    html.includes("new booking request from:")
  );
}

function dateString(value?: string | Date) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanText(value: string) {
  return value.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
}

function truncate(value: string, limit: number) {
  return value.length <= limit ? value : `${value.slice(0, limit - 3).trimEnd()}...`;
}

function normalizeInvoiceLineItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((line) => {
    const quantity = typeof line.quantity === "number" && Number.isFinite(line.quantity)
      ? Math.max(1, line.quantity)
      : 1;
    const label = stringOrNull(line.label) ?? "Popup Pearl catering";
    const unitPrice = stringOrNull(line.unitPrice) ?? stringOrNull(line.amount) ?? "$0.00";
    return {
      label,
      description: stringOrNull(line.description),
      quantity,
      unitPrice,
      amount: stringOrNull(line.amount) ?? unitPrice,
    };
  });
}

function invoicePreviewFromAgentLineItems(
  lineItems: InboxAiInvoiceLineItem[],
  generatedAt: string,
) {
  if (!lineItems.length) return undefined;
  return {
    id: `agent-preview-${generatedAt}`,
    status: "preview",
    lineItems,
    total: formatInvoiceTotal(lineItems),
    approvalGate:
      "Agent-generated Zoho-style preview only. Review and edit before creating anything in Zoho or Stripe.",
  };
}

function formatInvoiceTotal(lineItems: InboxAiInvoiceLineItem[]) {
  const cents = lineItems.reduce((sum, line) => {
    const amount = moneyToCents(line.amount);
    if (amount !== null) return sum + amount;
    const unitPrice = moneyToCents(line.unitPrice);
    return sum + (unitPrice ?? 0) * line.quantity;
  }, 0);
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(cents / 100);
}

function moneyToCents(value: string | null | undefined) {
  if (!value) return null;
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d{1,2})?/);
  return match ? Math.round(Number(match[0]) * 100) : null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
