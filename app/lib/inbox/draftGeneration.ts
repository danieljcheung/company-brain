import {
  InboxActionType,
  InboxDraftStatus,
  InboxEventStatus,
  InboxEvidenceKind,
  type Prisma,
} from "@prisma/client";

import { createInboxAction, createInboxEvidence } from "./manualImport";
import {
  analyzeInboxThreadWithOpenAI,
  hasOpenAIInboxAgent,
  openAIInboxModel,
  type InboxAiMessage,
} from "./aiAgent";
import {
  loadApprovedBrainContextForDraft,
  type InboxBrainContextRecord,
} from "./brainContext";
import { isVisibleInboxAttachment } from "./visibleAttachments";

type DraftField = {
  key: string;
  label: string;
  value: string;
  confidence?: number;
  sourceSnippet?: string;
};

export type DraftMessage = {
  id: string;
  bodyPlain: string | null;
  bodyHtml: string | null;
  snippet: string | null;
  from: Prisma.JsonValue;
  sentAt: Date | null;
  internalDate: Date | null;
  createdAt: Date;
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string | null;
    sizeBytes: number | null;
    contentId: string | null;
  }>;
};

type DraftEvent = {
  id: string;
  status: InboxEventStatus;
  extractedFields: Prisma.JsonValue;
  recommendedNextAction: string | null;
  thread: {
    subject: string;
    messages: DraftMessage[];
  };
  drafts: Array<{ id: string; body: string }>;
  brainContext: InboxBrainContextRecord[];
};

type DraftPlan = {
  subject: string;
  body: string;
  metadata: {
    generator: string;
    generatedAt: string;
    confidence: number;
    missingFields: string[];
    warnings: string[];
    evidenceSnippets: string[];
    fieldEvidence: DraftField[];
    brainRecords: Array<{
      id: string;
      section: string;
      title: string;
      rationale: string;
    }>;
    targetMessageId: string | null;
    targetMessageSnippet: string | null;
    targetMessageAuthor: string | null;
    targetMessageAt: string | null;
    previousDraftBody?: string;
    model?: string;
    method?: string;
    category?: string;
    invoiceReadiness?: Prisma.InputJsonValue;
    recommendedNextAction?: string;
    asksCustomerToConfirm?: boolean;
    aiDraftAttempted?: boolean;
    aiDraftError?: string;
  };
};


const popupPearlDomains = ["popuppearl.ca", "popup pearl"];

export async function generateInboxDraftForEvent(
  tx: Prisma.TransactionClient,
  input: {
    eventId: string;
    companyId: string;
    actorId?: string;
  },
) {
  const prepared = await prepareInboxDraftForEvent(tx, input);
  if (!prepared.ok) return prepared;

  return persistInboxDraftPlan(tx, {
    eventId: prepared.eventId,
    actorId: input.actorId,
    wasRegeneration: prepared.wasRegeneration,
    plan: prepared.plan,
  });
}

export async function prepareInboxDraftForEvent(
  db: Prisma.TransactionClient,
  input: {
    eventId: string;
    companyId: string;
  },
) {
  const event = await db.inboxEvent.findFirst({
    where: { id: input.eventId, companyId: input.companyId },
    include: {
      drafts: {
        where: { status: InboxDraftStatus.DRAFT },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { id: true, body: true },
      },
      thread: {
        include: {
          messages: {
            orderBy: [{ sentAt: "asc" }, { createdAt: "asc" }],
            include: {
              attachments: {
                orderBy: { createdAt: "asc" },
                select: { id: true, filename: true, mimeType: true, sizeBytes: true, contentId: true },
              },
            },
          },
        },
      },
    },
  });

  if (!event) {
    return { ok: false as const, status: 404, error: "Inbox event was not found." };
  }

  const eventStatus = String(event.status).toUpperCase();
  if (eventStatus !== "NEEDS_REPLY" && eventStatus !== "INVOICE_READY" && eventStatus !== "FOLLOW_UP") {
    return {
      ok: false as const,
      status: 409,
      error:
        "Draft generation is only available for active events. Review-only, waiting, and closed events are skipped.",
    };
  }
  const brainContext = await loadApprovedBrainContextForDraft(db, { companyId: input.companyId });
  const wasRegeneration = event.drafts.length > 0;
  const plan = await buildDraftPlan({ ...event, brainContext });
  if (!plan) {
    return {
      ok: false as const,
      status: 204,
      error: "No draft was generated because the latest thread message is already from Popup Pearl.",
    };
  }

  return {
    ok: true as const,
    eventId: event.id,
    wasRegeneration,
    plan,
  };
}

export async function prepareStoredAgentDraftForEvent(
  db: Prisma.TransactionClient,
  input: {
    eventId: string;
    companyId: string;
  },
) {
  const event = await db.inboxEvent.findFirst({
    where: { id: input.eventId, companyId: input.companyId },
    include: {
      drafts: {
        where: { status: InboxDraftStatus.DRAFT },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { id: true, body: true },
      },
      thread: {
        include: {
          messages: {
            orderBy: [{ sentAt: "asc" }, { createdAt: "asc" }],
            include: {
              attachments: {
                orderBy: { createdAt: "asc" },
                select: { id: true, filename: true, mimeType: true, sizeBytes: true, contentId: true },
              },
            },
          },
        },
      },
    },
  });

  if (!event) {
    return { ok: false as const, status: 404, error: "Inbox event was not found." };
  }
  const eventStatus = String(event.status).toUpperCase();
  if (eventStatus !== "NEEDS_REPLY" && eventStatus !== "INVOICE_READY" && eventStatus !== "FOLLOW_UP") {
    return {
      ok: false as const,
      status: 409,
      error: "Stored agent drafts are only saved for active customer events.",
    };
  }

  if (eventStatus !== "FOLLOW_UP" && latestThreadMessageIsPopupPearl(event.thread.messages)) {
    return {
      ok: false as const,
      status: 204,
      error: "No stored agent draft was generated because the latest thread message is already from Popup Pearl.",
    };
  }
  const brainContext = await loadApprovedBrainContextForDraft(db, { companyId: input.companyId });
  const plan = buildDraftPlanFromExtractedFields({
    subject: event.thread.subject,
    extractedFields: event.extractedFields,
    messages: event.thread.messages,
    brainContext,
    status: event.status,
  });

  if (!plan) {
    return {
      ok: false as const,
      status: 204,
      error: "No stored agent draft was available.",
    };
  }

  return {
    ok: true as const,
    eventId: event.id,
    wasRegeneration: event.drafts.length > 0,
    plan,
  };
}

export async function persistInboxDraftPlan(
  tx: Prisma.TransactionClient,
  input: {
    eventId: string;
    actorId?: string;
    wasRegeneration: boolean;
    plan: DraftPlan;
  },
) {
  const activeDrafts = await tx.inboxDraft.findMany({
    where: {
      eventId: input.eventId,
      status: InboxDraftStatus.DRAFT,
    },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });

  if (activeDrafts.length) {
    await tx.inboxDraft.updateMany({
      where: { id: { in: activeDrafts.map((draft) => draft.id) } },
      data: {
        status: InboxDraftStatus.REJECTED,
        rejectedAt: new Date(),
        rejectedById: input.actorId,
        rejectionNote: "Superseded by a newer local draft.",
      },
    });
  }

  const draft = await tx.inboxDraft.create({
    data: {
      eventId: input.eventId,
      subject: input.plan.subject,
      body: input.plan.body,
      status: InboxDraftStatus.DRAFT,
      modelMetadata: input.plan.metadata as Prisma.InputJsonObject,
    },
  });

  await createInboxAction(tx, {
    eventId: input.eventId,
    draftId: draft.id,
    actorId: input.actorId,
    actionType: input.wasRegeneration
      ? InboxActionType.DRAFT_REGENERATED
      : InboxActionType.DRAFT_GENERATED,
    after: {
      draftId: draft.id,
      supersededDraftIds: activeDrafts.map((activeDraft) => activeDraft.id),
      generator: input.plan.metadata.generator,
      confidence: input.plan.metadata.confidence,
      missingFields: input.plan.metadata.missingFields,
    },
    note: input.wasRegeneration
      ? "Regenerated a local review draft. No Gmail draft or send occurred."
      : "Generated a local review draft. No Gmail draft or send occurred.",
  });

  const evidenceFields = input.plan.metadata.fieldEvidence.slice(0, 6);
  for (const field of evidenceFields) {
    await createInboxEvidence(tx, {
      eventId: input.eventId,
      draftId: draft.id,
      kind: InboxEvidenceKind.EXTRACTED_FIELD,
      locator: field.key,
      evidenceText: `${field.label}: ${field.value}`,
      confidence: field.confidence,
      metadata: {
        sourceSnippet: field.sourceSnippet,
      },
    });
  }

  for (const snippet of input.plan.metadata.evidenceSnippets.slice(0, 3)) {
    await createInboxEvidence(tx, {
      eventId: input.eventId,
      draftId: draft.id,
      kind: InboxEvidenceKind.GMAIL_MESSAGE,
      evidenceText: snippet,
      confidence: input.plan.metadata.confidence,
    });
  }

  for (const record of input.plan.metadata.brainRecords) {
    await createInboxEvidence(tx, {
      eventId: input.eventId,
      draftId: draft.id,
      kind: InboxEvidenceKind.BRAIN_RECORD,
      brainRecordId: record.id,
      locator: record.section,
      evidenceText: `${record.title}: ${record.rationale}`,
      confidence: input.plan.metadata.confidence,
    });
  }

  return {
    ok: true as const,
    draft,
    actionType: input.wasRegeneration
      ? InboxActionType.DRAFT_REGENERATED
      : InboxActionType.DRAFT_GENERATED,
  };
}

export async function rejectLatestInboxDraft(
  tx: Prisma.TransactionClient,
  input: {
    eventId: string;
    companyId: string;
    actorId?: string;
    note?: string;
  },
) {
  const draft = await tx.inboxDraft.findFirst({
    where: {
      event: { id: input.eventId, companyId: input.companyId },
      status: InboxDraftStatus.DRAFT,
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!draft) {
    return { ok: false as const, status: 404, error: "No active local draft was found." };
  }

  const rejected = await tx.inboxDraft.update({
    where: { id: draft.id },
    data: {
      status: InboxDraftStatus.REJECTED,
      rejectedAt: new Date(),
      rejectedById: input.actorId,
      rejectionNote: input.note ?? "Rejected from Inbox review.",
    },
  });

  await createInboxAction(tx, {
    eventId: input.eventId,
    draftId: rejected.id,
    actorId: input.actorId,
    actionType: InboxActionType.DRAFT_REJECTED,
    before: { status: draft.status },
    after: { status: rejected.status },
    note: rejected.rejectionNote ?? "Rejected local draft. No Gmail action occurred.",
  });

  return { ok: true as const, draft: rejected };
}

async function buildDraftPlan(event: DraftEvent): Promise<DraftPlan | null> {
  if (event.status !== "FOLLOW_UP" && latestThreadMessageIsPopupPearl(event.thread.messages)) {
    return null;
  }

  const previousDraftBody = event.drafts[0]?.body ?? null;
  const deterministicPlan = buildConservativeDraft(event, {
    previousDraftBody,
    regenerate: Boolean(previousDraftBody),
  });
  if (!hasOpenAIInboxAgent()) return deterministicPlan;

  try {
    const targetMessage = latestCustomerMessage(event.thread.messages);
    const { result, metadata } = await analyzeInboxThreadWithOpenAI({
      subject: event.thread.subject,
      deterministicExtractedFields: event.extractedFields,
      regenerationRequest: previousDraftBody
        ? "Regenerate the local draft with noticeably different wording while preserving the same facts and safety limits."
        : undefined,
      previousDraftBody,
      attachmentsSummary: summarizeDraftAttachments(event.thread.messages),
      messages: event.thread.messages.map(toInboxAiMessage),
      latestCustomerMessage: targetMessage ? toInboxAiMessage(targetMessage) : null,
      toneExamples: event.thread.messages
        .filter((message) => isPopupPearlAddress(message.from))
        .slice(-5)
        .map(toInboxAiMessage),
      approvedBrainRecords: event.brainContext,
      isFollowUp: event.status === "FOLLOW_UP" || latestThreadMessageIsPopupPearl(event.thread.messages),
    });

    const body = result.draft.body.trim();
    if (!body) {
      throw new Error("OpenAI Inbox agent returned an empty draft body.");
    }

    const targetSnippet = targetMessage
      ? latestMessageSnippet(targetMessage.bodyPlain ?? targetMessage.snippet ?? "")
      : null;
    const evidenceSnippets = result.fieldEvidence
      .map((item) => item.sourceSnippet)
      .filter((snippet): snippet is string => Boolean(snippet))
      .slice(0, 4);

    return {
      subject: ensureReplySubject(result.draft.subject || event.thread.subject || "Popup Pearl inquiry"),
      body,
      metadata: {
        generator: "openai_responses_api_inbox_agent_v1",
        model: metadata.model,
        method: metadata.method,
        generatedAt: metadata.generatedAt,
        confidence: metadata.confidence,
        category: result.threadCategory,
        missingFields: result.missingFields,
        warnings: [
          ...result.warnings,
          ...brainContextWarnings(event.brainContext),
          "Local draft only. No Gmail draft, Gmail send, labels, or external writes.",
        ],
        evidenceSnippets: evidenceSnippets.length
          ? evidenceSnippets
          : deterministicPlan.metadata.evidenceSnippets,
        fieldEvidence: result.fieldEvidence
          .filter((field) => field.value)
          .map((field) => ({
            key: field.field,
            label: labelizeField(field.field),
            value: field.value ?? "",
            confidence: field.confidence,
            sourceSnippet: field.sourceSnippet ?? undefined,
          })),
        brainRecords: selectedBrainRecords(
          event.brainContext,
          result.brainRecordEvidence,
        ),
        invoiceReadiness: result.invoiceReadiness,
        recommendedNextAction: result.recommendedNextAction,
        asksCustomerToConfirm: result.draft.asksCustomerToConfirm,
        targetMessageId: targetMessage?.id ?? null,
        targetMessageSnippet: targetSnippet,
        targetMessageAuthor: targetMessage ? addressLabel(targetMessage.from) : null,
        targetMessageAt: targetMessage ? messageTimestamp(targetMessage)?.toISOString() ?? null : null,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenAI Inbox draft generation failed.";
    return {
      ...deterministicPlan,
      metadata: {
        ...deterministicPlan.metadata,
        aiDraftAttempted: true,
        aiDraftError: message,
        model: openAIInboxModel(),
        method: "openai_responses_api",
        warnings: [
          ...deterministicPlan.metadata.warnings,
          `OpenAI draft fallback used: ${message}`,
        ],
      },
    };
  }
}

export function buildDraftPlanFromExtractedFields(input: {
  subject: string;
  extractedFields: Prisma.JsonValue;
  messages: DraftMessage[];
  brainContext?: InboxBrainContextRecord[];
  status?: string;
}): DraftPlan | null {
  if (input.status !== "FOLLOW_UP" && latestThreadMessageIsPopupPearl(input.messages)) {
    return null;
  }

  if (!isRecord(input.extractedFields)) return null;
  const draft = input.extractedFields.draft;
  if (!isRecord(draft)) return null;

  const body = stringValue(draft.body);
  if (!body) return null;

  const targetMessage = latestCustomerMessage(input.messages);
  const targetSnippet = targetMessage
    ? latestMessageSnippet(targetMessage.bodyPlain ?? targetMessage.snippet ?? "")
    : null;
  const fieldEvidence = readDraftFields(input.extractedFields);
  const missingFields = readMissingFields(input.extractedFields);
  const evidenceSnippets = Array.isArray(input.extractedFields.fieldEvidence)
    ? input.extractedFields.fieldEvidence
        .map((item) => (isRecord(item) ? stringValue(item.sourceSnippet) : null))
        .filter((snippet): snippet is string => Boolean(snippet))
        .slice(0, 4)
    : collectEvidenceSnippets(input.messages, targetMessage);

  return {
    subject: ensureReplySubject(stringValue(draft.subject) ?? input.subject ?? "Popup Pearl inquiry"),
    body,
    metadata: {
      generator: "openai_responses_api_inbox_agent_v1",
      model: stringValue(input.extractedFields.aiModel) ?? openAIInboxModel(),
      method: stringValue(input.extractedFields.aiMethod) ?? "openai_responses_api",
      generatedAt: stringValue(input.extractedFields.extractedAt) ?? new Date().toISOString(),
      confidence:
        numberValue(input.extractedFields.aiConfidence) ??
        calculateConfidence(fieldEvidence.length, missingFields.length),
      category: stringValue(input.extractedFields.threadCategory) ?? undefined,
      missingFields,
      warnings: [
        ...readStringArray(input.extractedFields.warnings),
        "Local draft only. No Gmail draft, Gmail send, labels, or external writes.",
      ],
      evidenceSnippets,
      fieldEvidence,
      brainRecords: selectedBrainRecords(
        input.brainContext ?? [],
        readBrainRecordEvidence(input.extractedFields),
      ),
      invoiceReadiness: isRecord(input.extractedFields.invoiceReadiness)
        ? (input.extractedFields.invoiceReadiness as Prisma.InputJsonObject)
        : undefined,
      recommendedNextAction: stringValue(input.extractedFields.recommendedNextAction) ?? undefined,
      asksCustomerToConfirm: Boolean(draft.asksCustomerToConfirm),
      targetMessageId: targetMessage?.id ?? null,
      targetMessageSnippet: targetSnippet,
      targetMessageAuthor: targetMessage ? addressLabel(targetMessage.from) : null,
      targetMessageAt: targetMessage ? messageTimestamp(targetMessage)?.toISOString() ?? null : null,
    },
  };
}

function buildConservativeDraft(
  event: DraftEvent,
  options: { previousDraftBody?: string | null; regenerate?: boolean } = {},
): DraftPlan {
  const fields = readDraftFields(event.extractedFields);
  const missingFields = readMissingFields(event.extractedFields);
  const fieldMap = new Map(fields.map((field) => [field.key, field]));
  const customerName = firstText(fieldMap.get("customerName")?.value, "there");
  const knownLines = [
    sentenceIf("eventDate", fieldMap, "Date"),
    sentenceIf("serviceWindow", fieldMap, "Time/window"),
    sentenceIf("location", fieldMap, "Location"),
    sentenceIf("quantityOrGuestCount", fieldMap, "Guest count/quantity"),
    sentenceIf("service", fieldMap, "Service"),
    sentenceIf("flavours", fieldMap, "Flavours"),
    sentenceIf("toppings", fieldMap, "Toppings"),
    sentenceIf("tierPackage", fieldMap, "Package"),
    sentenceIf("size", fieldMap, "Size"),
    sentenceIf("customAddOns", fieldMap, "Add-ons"),
  ].filter(Boolean);
  const warnings = [
    ...brainContextWarnings(event.brainContext),
    "Local draft only. No Gmail draft, Gmail send, labels, or external writes.",
    "Price and operational details require human review before any customer send.",
  ];
  const targetMessage = latestCustomerMessage(event.thread.messages);
  const targetSnippet = targetMessage
    ? latestMessageSnippet(targetMessage.bodyPlain ?? targetMessage.snippet ?? "")
    : null;
  const targetAuthor = targetMessage ? addressLabel(targetMessage.from) : null;
  const targetMessageAt = targetMessage ? messageTimestamp(targetMessage)?.toISOString() ?? null : null;
  const evidenceSnippets = collectEvidenceSnippets(event.thread.messages, targetMessage);
  const hasLogoEvidence = hasLogoOrStickerEvidence(fields, event.thread.messages);
  const hasAttachmentEvidence = event.thread.messages.some(
    (message) => message.attachments.some(isVisibleInboxAttachment),
  );
  const confidence = calculateConfidence(fields.length, missingFields.length);
  const bodyLines = options.regenerate
    ? [
        `Hi ${customerName},`,
        "",
        "Thanks again for your message. I reviewed the thread and pulled together the key details below.",
      ]
    : [
        `Hi ${customerName},`,
        "",
        "Thanks for reaching out to Popup Pearl. We can help review this and pull the details together.",
      ];

  if (targetSnippet) {
    bodyLines.push(
      "",
      `Replying to your latest note: "${targetSnippet}"`,
    );
  }

  if (knownLines.length) {
    bodyLines.push("", "Here is what we have so far:", ...knownLines.map((line) => `- ${line}`));
  }

  if (hasLogoEvidence) {
    bodyLines.push(
      "",
      "We also saw the sticker/logo note and will keep that in mind while reviewing the setup.",
    );
  } else if (hasAttachmentEvidence) {
    bodyLines.push("", "We saw the attachment(s) on the thread and will review them before confirming details.");
  }

  if (missingFields.length) {
    bodyLines.push(
      "",
      "Could you confirm the missing details below so we can quote this accurately?",
      ...missingFields.map((field) => `- ${field}`),
    );
  } else {
    bodyLines.push(
      "",
      options.regenerate
        ? "The core details look captured. We will review availability and come back with the right next step."
        : "We have the core event details here. We will review availability and follow up with the next step.",
    );
  }

  bodyLines.push(
    "",
    options.regenerate
      ? "We will keep price and logistics conservative until everything is confirmed."
      : "We will avoid guessing on price or final logistics until we confirm everything.",
    "",
    "Best,",
    "Popup Pearl",
  );

  return {
    subject: ensureReplySubject(event.thread.subject || "Popup Pearl inquiry"),
    body: bodyLines.join("\n"),
    metadata: {
      generator: "deterministic_popup_pearl_v1",
      generatedAt: new Date().toISOString(),
      confidence,
      missingFields,
      warnings,
      evidenceSnippets,
      fieldEvidence: fields,
      brainRecords: selectedBrainRecords(event.brainContext),
      targetMessageId: targetMessage?.id ?? null,
      targetMessageSnippet: targetSnippet,
      targetMessageAuthor: targetAuthor,
      targetMessageAt,
      previousDraftBody: options.previousDraftBody ? options.previousDraftBody.slice(0, 500) : undefined,
    },
  };
}

function selectedBrainRecords(
  records: InboxBrainContextRecord[],
  evidence?: Array<{ id: string; rationale: string }> | null,
) {
  const evidenceById = new Map((evidence ?? []).map((item) => [item.id, item.rationale]));
  const selected = evidence?.length
    ? records.filter((record) => evidenceById.has(record.id))
    : records.slice(0, 4);
  return selected.map((record) => ({
    id: record.id,
    section: record.section,
    title: record.title,
    rationale:
      evidenceById.get(record.id) ??
      `Approved ${record.sectionLabel} context supplied for conservative draft review.`,
  }));
}

function brainContextWarnings(records: InboxBrainContextRecord[]) {
  return records.length ? [] : ["No approved Company Brain records were available for this draft."];
}

function readBrainRecordEvidence(value: Prisma.JsonValue) {
  if (!isRecord(value) || !Array.isArray(value.brainRecordEvidence)) return [];
  return value.brainRecordEvidence
    .map((item) => {
      if (!isRecord(item)) return null;
      const id = stringValue(item.id);
      const rationale = stringValue(item.rationale);
      return id && rationale ? { id, rationale } : null;
    })
    .filter((item): item is { id: string; rationale: string } => Boolean(item));
}

function latestThreadMessageIsPopupPearl(messages: DraftMessage[]) {
  const latestMessage = messages[messages.length - 1];
  return latestMessage
    ? isPopupPearlAddress(latestMessage.from) && !isNewBookingRequestNotification(latestMessage)
    : false;
}

function toInboxAiMessage(message: DraftMessage): InboxAiMessage {
  return {
    id: message.id,
    author: addressLabel(message.from),
    fromEmail: addressEmail(message.from),
    isCustomer: !isPopupPearlAddress(message.from) || isNewBookingRequestNotification(message),
    subject: null,
    body: message.bodyPlain ?? message.snippet ?? "",
    sentAt: messageTimestamp(message)?.toISOString() ?? null,
    attachments: message.attachments.filter(isVisibleInboxAttachment).map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      contentId: attachment.contentId,
    })),
  };
}

function readDraftFields(value: Prisma.JsonValue): DraftField[] {
  if (!isRecord(value) || !Array.isArray(value.fields)) return [];

  return value.fields
    .map(toDraftField)
    .filter((field): field is DraftField => Boolean(field));
}

function readMissingFields(value: Prisma.JsonValue) {
  if (!isRecord(value) || !Array.isArray(value.missingFields)) return [];
  return value.missingFields.map(displayValue).filter((item): item is string => Boolean(item));
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(stringValue).filter((item): item is string => Boolean(item));
}

function collectEvidenceSnippets(messages: DraftMessage[], targetMessage: DraftMessage | null) {
  const snippets = messages
    .filter((message) => message.id !== targetMessage?.id && (!isPopupPearlAddress(message.from) || isNewBookingRequestNotification(message)))
    .map((message) => cleanText(message.bodyPlain ?? message.snippet ?? ""))
    .filter(Boolean)
    .map((text) => text.slice(0, 220))
    .slice(-3);

  if (!targetMessage) return snippets;

  const targetSnippet = latestMessageSnippet(targetMessage.bodyPlain ?? targetMessage.snippet ?? "");
  return targetSnippet ? [`Latest customer message: ${targetSnippet}`, ...snippets].slice(0, 3) : snippets;
}

function latestCustomerMessage(messages: DraftMessage[]) {
  return messages
    .filter((message) => !isPopupPearlAddress(message.from) || isNewBookingRequestNotification(message))
    .sort((a, b) => {
      const bTime = messageTimestamp(b)?.getTime() ?? 0;
      const aTime = messageTimestamp(a)?.getTime() ?? 0;
      return bTime - aTime;
    })[0] ?? null;
}

function messageTimestamp(message: DraftMessage) {
  return message.sentAt ?? message.internalDate ?? message.createdAt ?? null;
}

function hasLogoOrStickerEvidence(fields: DraftField[], messages: DraftMessage[]) {
  const fieldEvidence = fields.some(
    (field) =>
      field.key === "stickerLogoRequest" &&
      /\b(logo|sticker|label|decal|custom)\b/i.test(field.value),
  );
  const attachmentEvidence = messages.some((message) =>
    message.attachments.filter(isVisibleInboxAttachment).some((attachment) =>
      /\b(logo|sticker|label|decal|brand)\b/i.test(attachment.filename),
    ),
  );
  return fieldEvidence || attachmentEvidence;
}

function sentenceIf(
  key: string,
  fields: Map<string, DraftField>,
  label: string,
) {
  const value = fields.get(key)?.value;
  const safeValue = value ? sanitizeFieldForDraft(key, value) : null;
  return safeValue ? `${label}: ${safeValue}` : null;
}

function calculateConfidence(fieldCount: number, missingCount: number) {
  const base = Math.min(0.9, 0.45 + fieldCount * 0.05);
  return Math.max(0.35, Number((base - missingCount * 0.04).toFixed(2)));
}

function ensureReplySubject(subject: string) {
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

function firstText(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  return value.split(/\s+/).filter(Boolean)[0] ?? fallback;
}

export function isPopupPearlAddress(value: Prisma.JsonValue) {
  const text = JSON.stringify(value).toLowerCase();
  if (text.includes("wordpress") || text.includes("wix") || text.includes("no-reply") || text.includes("noreply") || text.includes("website")) {
    return false;
  }
  return popupPearlDomains.some((domain) => text.includes(domain));
}

export function isNewBookingRequestNotification(message?: {
  subject?: string | null;
  bodyPlain?: string | null;
  snippet?: string | null;
  bodyHtml?: string | null;
}) {
  if (!message) return false;
  const snippet = (message.snippet ?? "").toLowerCase();
  const body = (message.bodyPlain ?? "").toLowerCase();
  const html = (message.bodyHtml ?? "").toLowerCase();
  return (
    snippet.includes("new booking request from:") ||
    body.includes("new booking request from:") ||
    html.includes("new booking request from:")
  );
}

function addressEmail(value: Prisma.JsonValue) {
  if (isRecord(value)) return stringValue(value.email);
  return null;
}

function addressLabel(value: Prisma.JsonValue) {
  if (isRecord(value)) {
    const name = stringValue(value.name);
    const email = stringValue(value.email);
    return name ?? email ?? "Customer";
  }

  return "Customer";
}

function summarizeDraftAttachments(messages: DraftMessage[]) {
  const filenames = messages.flatMap((message) =>
    message.attachments.filter(isVisibleInboxAttachment).map((attachment) => attachment.filename),
  );
  return filenames.length ? filenames.join(", ") : "No attachments.";
}

function labelizeField(value: string) {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase())
    .replace(/\bOr\b/g, "/")
    .trim();
}

function cleanText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function latestMessageSnippet(value: string) {
  const text = cleanText(value).replace(
    /^no text body was imported for this gmail message\.$/i,
    "",
  );

  if (!text) return "No readable message text was imported.";
  return text.length <= 180 ? text : `${text.slice(0, 177).trimEnd()}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function displayValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const items = value.map(displayValue).filter(Boolean);
    return items.length ? items.join(", ") : null;
  }
  return null;
}

function sanitizeFieldForDraft(key: string, value: string) {
  const stopLabelsByKey: Record<string, string[]> = {
    location: ["Total Price", "Comments", "Sticker Logo", "Service", "Tier"],
    flavours: ["Toppings", "Quantity", "Size", "New Booking Request", "Service", "Tier"],
    toppings: ["Quantity", "Size", "New Booking Request", "Service", "Tier"],
    tierPackage: ["Event Date", "Selections", "Flavors", "Flavours", "Toppings"],
    size: ["Start Time", "Location", "Total Price", "Comments"],
    customAddOns: ["Total Price", "Comments", "Sticker Logo"],
    specialNotes: ["Sticker Logo", "Click on the link", "https://"],
  };
  const stopLabels = stopLabelsByKey[key] ?? [];
  let safeValue = value.replace(/\s+/g, " ").trim();

  for (const label of stopLabels) {
    const index = safeValue.toLowerCase().indexOf(label.toLowerCase());
    if (index > 0) safeValue = safeValue.slice(0, index).trim();
  }

  safeValue = safeValue
    .replace(/\s*\|\s*$/, "")
    .replace(/[:;,.\s]+$/, "")
    .trim();

  if (!safeValue || /^https?:\/\//i.test(safeValue)) return null;
  return safeValue.length > 90 ? `${safeValue.slice(0, 87).trim()}...` : safeValue;
}

function toDraftField(value: unknown): DraftField | null {
  if (!isRecord(value)) return null;

  const key = stringValue(value.key);
  const fieldValue = displayValue(value.value);
  if (!key || !fieldValue) return null;

  return {
    key,
    label: stringValue(value.label) ?? key,
    value: fieldValue,
    confidence: numberValue(value.confidence),
    sourceSnippet: stringValue(value.sourceSnippet) ?? undefined,
  };
}
