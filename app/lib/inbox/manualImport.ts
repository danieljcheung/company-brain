import {
  GmailThreadTrackStatus,
  InboxActionType,
  InboxEventSource,
  InboxEventStatus,
  InboxEvidenceKind,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  extractEventDetails,
  serializeEventDetailsExtraction,
  type EventDetailsMessage,
} from "./eventDetails";

const USER_FACING_STATUS: Record<string, InboxEventStatus> = {
  needs_reply: InboxEventStatus.NEEDS_REPLY,
  awaiting_customer: InboxEventStatus.AWAITING_CUSTOMER,
  invoice_ready: InboxEventStatus.INVOICE_READY,
  invoiced: InboxEventStatus.INVOICED,
  manual_review: InboxEventStatus.MANUAL_REVIEW,
  follow_up: InboxEventStatus.FOLLOW_UP,
  complete: InboxEventStatus.COMPLETE,
};

const STATUS_LABELS: Record<InboxEventStatus, keyof typeof USER_FACING_STATUS> = {
  [InboxEventStatus.NEEDS_REPLY]: "needs_reply",
  [InboxEventStatus.AWAITING_CUSTOMER]: "awaiting_customer",
  [InboxEventStatus.INVOICE_READY]: "invoice_ready",
  [InboxEventStatus.INVOICED]: "invoiced",
  [InboxEventStatus.MANUAL_REVIEW]: "manual_review",
  [InboxEventStatus.FOLLOW_UP]: "follow_up",
  [InboxEventStatus.COMPLETE]: "complete",
};

const PROMO_MARKERS = [
  "unsubscribe",
  "view in browser",
  "newsletter",
  "promotion",
  "limited time offer",
  "sale ends",
  "marketing",
  "advertisement",
  "sponsored",
  "mailing list",
];

const DIRECT_CATERING_MARKERS = [
  "catering",
  "pop up",
  "popup",
  "event",
  "booking",
  "book",
  "quote",
  "invoice",
  "matcha",
  "drinks",
  "party",
  "wedding",
  "corporate",
  "birthday",
];

const DIRECT_DETAIL_MARKERS = [
  "date",
  "time",
  "location",
  "venue",
  "guests",
  "people",
  "attendees",
  "quantity",
  "how much",
  "pricing",
  "available",
  "availability",
];

const BOOKING_DETAIL_MARKERS = [
  "service:",
  "tier:",
  "event date:",
  "selections:",
  "quantity:",
  "start time:",
  "location:",
  "guests:",
  "comments:",
];

const AUTOMATED_RESPONSE_MARKERS = [
  "automatic reply:",
  "auto-reply:",
  "out of office",
  "out-of-office",
  "vacation responder",
  "thank you for reaching out",
];

export type UserFacingInboxStatus = keyof typeof USER_FACING_STATUS;

export type MockAddress = {
  email?: string;
  name?: string;
};

export type MockAttachmentInput = {
  gmailAttachmentId?: string;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  contentId?: string;
  storageRef?: string;
  metadata?: Record<string, unknown>;
};

export type MockMessageInput = {
  gmailMessageId: string;
  subject?: string;
  from?: MockAddress;
  to?: MockAddress[];
  cc?: MockAddress[];
  bcc?: MockAddress[];
  replyTo?: MockAddress[];
  snippet?: string;
  bodyPlain?: string;
  bodyHtml?: string;
  sentAt?: string | Date;
  internalDate?: string | Date;
  metadata?: Record<string, unknown>;
  attachments?: MockAttachmentInput[];
};

export type MockThreadInput = {
  gmailThreadId: string;
  subject: string;
  participants?: MockAddress[];
  labels?: string[];
  isArchived?: boolean;
  latestMessageAt?: string | Date;
  metadata?: Record<string, unknown>;
  messages: MockMessageInput[];
};

type ClassificationResult =
  | {
      shouldCreate: true;
      source: InboxEventSource;
      status: InboxEventStatus;
      reason: string;
      evidence: Array<{
        messageId?: string;
        text: string;
        confidence: number;
        locator?: string;
      }>;
    }
  | {
      shouldCreate: false;
      reason: string;
      evidence: Array<{
        messageId?: string;
        text: string;
        confidence: number;
        locator?: string;
      }>;
    };

export type ManualImportOptions = {
  companyId: string;
  actorId?: string;
  force?: boolean;
  requestedStatus?: string;
  note?: string;
  extractedFieldsOverride?: Prisma.InputJsonObject;
  extractionMetadata?: Record<string, unknown>;
};

export function validateUserFacingInboxStatus(value: string): InboxEventStatus {
  const normalized = value.trim().toLowerCase();
  const status = USER_FACING_STATUS[normalized];
  if (!status) {
    throw new Error(
      "Invalid inbox status. Use needs_reply, awaiting_customer, invoice_ready, invoiced, manual_review, follow_up, or complete.",
    );
  }
  return status;
}

export function toUserFacingInboxStatus(status: InboxEventStatus): UserFacingInboxStatus {
  return STATUS_LABELS[status];
}

export function hasWordPressBookingMarker(input: MockThreadInput) {
  const haystack = threadSearchText(input);
  return (
    /\b(wordpress|wix)\b/i.test(haystack) &&
    /\b(booking|catering|request|form)\b/i.test(haystack)
  );
}

export function hasNewBookingRequestMarker(input: MockThreadInput) {
  return /new booking request from:/i.test(threadSearchText(input));
}

export function isPromotionOrNewsletter(input: MockThreadInput) {
  const haystack = threadSearchText(input).toLowerCase();
  return PROMO_MARKERS.some((marker) => haystack.includes(marker));
}

export function hasConservativeDirectCateringIntent(input: MockThreadInput) {
  const haystack = threadSearchText(input).toLowerCase();
  if (isPromotionOrNewsletter(input)) return false;

  const directMarkerCount = countMarkers(haystack, DIRECT_CATERING_MARKERS);
  const detailMarkerCount = countMarkers(haystack, DIRECT_DETAIL_MARKERS);
  const questionOrRequest = /\b(can|could|would|are you|do you|please|interested|looking)\b/i.test(
    haystack,
  );

  return directMarkerCount >= 2 && detailMarkerCount >= 1 && questionOrRequest;
}

export function classifyMockThread(input: MockThreadInput): ClassificationResult {
  if (isAutomatedResponseWithoutBookingDetails(input)) {
    return {
      shouldCreate: false,
      reason: "automated_response_without_booking_details_rejected",
      evidence: firstEvidence(input, "Automated response without booking details detected.", 0.95),
    };
  }

  if (hasNewBookingRequestMarker(input)) {
    return {
      shouldCreate: true,
      source: InboxEventSource.NEW_BOOKING_REQUEST,
      status: InboxEventStatus.NEEDS_REPLY,
      reason: "new_booking_request_marker",
      evidence: firstEvidence(input, "Found New Booking Request from: marker.", 0.99),
    };
  }

  if (hasWordPressBookingMarker(input)) {
    return {
      shouldCreate: true,
      source: InboxEventSource.WORDPRESS_BOOKING_FORM,
      status: InboxEventStatus.NEEDS_REPLY,
      reason: "wordpress_booking_form_marker",
      evidence: firstEvidence(input, "Found WordPress booking form marker.", 0.95),
    };
  }

  if (isPromotionOrNewsletter(input)) {
    return {
      shouldCreate: false,
      reason: "promo_or_newsletter_rejected",
      evidence: firstEvidence(input, "Promotion/newsletter marker detected.", 0.95),
    };
  }

  if (hasConservativeDirectCateringIntent(input)) {
    return {
      shouldCreate: true,
      source: InboxEventSource.DIRECT_CATERING_INTENT,
      status: InboxEventStatus.NEEDS_REPLY,
      reason: "conservative_direct_catering_intent",
      evidence: firstEvidence(input, "Direct email has conservative catering intent markers.", 0.75),
    };
  }

  return {
    shouldCreate: false,
    reason: "no_safe_inbox_trigger",
    evidence: firstEvidence(input, "No Phase 1 inbox trigger matched.", 0.6),
  };
}

export async function createInboxEventFromMockThread(
  tx: Prisma.TransactionClient,
  input: MockThreadInput,
  options: ManualImportOptions,
) {
  const classification = classifyMockThread(input);
  if (!classification.shouldCreate && !options.force) {
    return { created: false as const, classification };
  }

  const now = new Date();
  let status = options.requestedStatus
    ? validateUserFacingInboxStatus(options.requestedStatus)
    : classification.shouldCreate
      ? classification.status
      : InboxEventStatus.MANUAL_REVIEW;
  const source =
    options.force || !classification.shouldCreate
      ? InboxEventSource.MANUAL_IMPORT
      : classification.source;
  const manualImport = options.force || source === InboxEventSource.MANUAL_IMPORT;

  const thread = await tx.gmailThread.upsert({
    where: {
      companyId_gmailThreadId: {
        companyId: options.companyId,
        gmailThreadId: input.gmailThreadId,
      },
    },
    update: {
      subject: input.subject,
      participants: jsonArray(input.participants),
      labels: jsonArray(input.labels),
      isArchived: Boolean(input.isArchived),
      latestMessageAt: toDate(input.latestMessageAt) ?? latestMessageDate(input.messages),
      trackStatus: GmailThreadTrackStatus.TRACKED,
      metadata: jsonObject(input.metadata),
    },
    create: {
      companyId: options.companyId,
      gmailThreadId: input.gmailThreadId,
      subject: input.subject,
      participants: jsonArray(input.participants),
      labels: jsonArray(input.labels),
      isArchived: Boolean(input.isArchived),
      latestMessageAt: toDate(input.latestMessageAt) ?? latestMessageDate(input.messages),
      trackStatus: GmailThreadTrackStatus.TRACKED,
      metadata: jsonObject(input.metadata),
    },
  });

  const messages = [];
  for (const messageInput of input.messages) {
    const message = await tx.gmailMessage.upsert({
      where: {
        threadId_gmailMessageId: {
          threadId: thread.id,
          gmailMessageId: messageInput.gmailMessageId,
        },
      },
      update: messageData(messageInput),
      create: {
        threadId: thread.id,
        gmailMessageId: messageInput.gmailMessageId,
        ...messageData(messageInput),
      },
    });

    const attachments = messageInput.attachments ?? [];
    const gmailAttachmentIds = attachments
      .map((attachment) => attachment.gmailAttachmentId)
      .filter((id): id is string => Boolean(id));
    if (!attachments.length) {
      await tx.gmailAttachment.deleteMany({ where: { messageId: message.id } });
    } else {
      for (const attachment of attachments) {
        if (attachment.gmailAttachmentId) {
          await tx.gmailAttachment.upsert({
            where: {
              messageId_gmailAttachmentId: {
                messageId: message.id,
                gmailAttachmentId: attachment.gmailAttachmentId,
              },
            },
            update: attachmentData(attachment),
            create: {
              messageId: message.id,
              ...attachmentData(attachment),
            },
          });
          continue;
        }

        const existingAttachment = await tx.gmailAttachment.findFirst({
          where: {
            messageId: message.id,
            gmailAttachmentId: null,
            filename: attachment.filename,
            contentId: attachment.contentId ?? null,
          },
          orderBy: { createdAt: "asc" },
        });
        if (existingAttachment) {
          await tx.gmailAttachment.update({
            where: { id: existingAttachment.id },
            data: attachmentData(attachment),
          });
        } else {
          await tx.gmailAttachment.create({
            data: {
              messageId: message.id,
              ...attachmentData(attachment),
            },
          });
        }
      }

      await tx.gmailAttachment.deleteMany({
        where: {
          messageId: message.id,
          gmailAttachmentId: { not: null, notIn: gmailAttachmentIds },
        },
      });
    }

    messages.push(message);
  }

  const existingEvent = await tx.inboxEvent.findUnique({
    where: { threadId: thread.id },
  });
  const extractedFields =
    options.extractedFieldsOverride ??
    buildExtractedFields(input, messages, classification.reason, now, options.extractionMetadata);
  status = statusFromAgentOutput(status, extractedFields);
  if (status === InboxEventStatus.INVOICE_READY && !isInvoiceReadyExtractedFields(extractedFields)) {
    status = InboxEventStatus.NEEDS_REPLY;
  }
  const nextAction = recommendedNextAction(status, extractedFields);
  const event = await tx.inboxEvent.upsert({
    where: { threadId: thread.id },
    update: {
      status,
      source,
      manualImport,
      extractedFields,
      recommendedNextAction: nextAction,
      completedAt: status === InboxEventStatus.COMPLETE ? now : null,
    },
    create: {
      companyId: options.companyId,
      threadId: thread.id,
      status,
      source,
      manualImport,
      extractedFields,
      recommendedNextAction: nextAction,
      completedAt: status === InboxEventStatus.COMPLETE ? now : null,
    },
  });

  const primaryMessage = messages[0];
  await createInboxAction(tx, {
    eventId: event.id,
    messageId: primaryMessage?.id,
    actorId: options.actorId,
    actionType: existingEvent
      ? InboxActionType.STATUS_CHANGED
      : manualImport
        ? InboxActionType.MANUAL_IMPORTED
        : InboxActionType.CREATED,
    before: existingEvent ? { status: toUserFacingInboxStatus(existingEvent.status) } : {},
    after: {
      status: toUserFacingInboxStatus(status),
      source,
      classificationReason: classification.reason,
    },
    note: options.note,
  });

  if (classification.shouldCreate) {
    await createInboxAction(tx, {
      eventId: event.id,
      messageId: primaryMessage?.id,
      actorId: options.actorId,
      actionType: InboxActionType.CLASSIFIED,
      after: {
        source,
        reason: classification.reason,
      },
    });
  }

  await createClassificationEvidence(tx, {
    eventId: event.id,
    messagesByGmailId: new Map(messages.map((message) => [message.gmailMessageId, message.id])),
    classification,
  });
  await createAgentRunAudit(tx, {
    eventId: event.id,
    messagesByGmailId: new Map(messages.map((message) => [message.gmailMessageId, message.id])),
    extractedFields,
    status,
    actorId: options.actorId,
  });

  return { created: true as const, classification, event, thread };
}

export async function createInboxAction(
  tx: Prisma.TransactionClient,
  input: {
    eventId: string;
    actionType: InboxActionType;
    draftId?: string;
    messageId?: string;
    actorId?: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    note?: string;
  },
) {
  return tx.inboxAction.create({
    data: {
      eventId: input.eventId,
      draftId: input.draftId,
      messageId: input.messageId,
      actorId: input.actorId,
      actionType: input.actionType,
      before: jsonObject(input.before),
      after: jsonObject(input.after),
      note: input.note,
    },
  });
}

export async function createInboxEvidence(
  tx: Prisma.TransactionClient,
  input: {
    eventId: string;
    kind: InboxEvidenceKind;
    draftId?: string;
    gmailMessageId?: string;
    gmailAttachmentId?: string;
    brainRecordId?: string;
    externalRef?: string;
    locator?: string;
    evidenceText: string;
    confidence?: number;
    metadata?: Record<string, unknown>;
  },
) {
  return tx.inboxEvidence.create({
    data: {
      eventId: input.eventId,
      kind: input.kind,
      draftId: input.draftId,
      gmailMessageId: input.gmailMessageId,
      gmailAttachmentId: input.gmailAttachmentId,
      brainRecordId: input.brainRecordId,
      externalRef: input.externalRef,
      locator: input.locator,
      evidenceText: input.evidenceText,
      confidence: input.confidence,
      metadata: jsonObject(input.metadata),
    },
  });
}

export const mockWordPressBookingThread: MockThreadInput = {
  gmailThreadId: "mock-thread-wordpress-booking-phase-1",
  subject: "New Booking Request from: Maya Chen",
  participants: [{ name: "Maya Chen", email: "maya@example.com" }],
  labels: ["INBOX"],
  messages: [
    {
      gmailMessageId: "mock-message-wordpress-booking-phase-1",
      subject: "New Booking Request from: Maya Chen",
      from: { name: "Popup Pearl Website", email: "wordpress@popuppearl.example" },
      to: [{ name: "Popup Pearl", email: "hello@popuppearl.example" }],
      sentAt: "2026-06-02T14:00:00.000Z",
      snippet: "New Booking Request from: Maya Chen for a catering event.",
      bodyPlain:
        "WordPress form notification\nNew Booking Request from: Maya Chen\nService: Matcha catering\nEvent date: 2026-07-18\nLocation: Toronto\nGuests: 45\nComments: Can you confirm availability and pricing?",
    },
  ],
};

function threadSearchText(input: MockThreadInput) {
  return [
    input.subject,
    input.participants?.map((participant) => `${participant.name ?? ""} ${participant.email ?? ""}`).join(" "),
    input.messages
      .map((message) =>
        [message.subject, message.snippet, message.bodyPlain, message.bodyHtml].filter(Boolean).join("\n"),
      )
      .join("\n"),
  ]
    .filter(Boolean)
    .join("\n");
}

function countMarkers(haystack: string, markers: string[]) {
  return markers.reduce((count, marker) => count + (haystack.includes(marker) ? 1 : 0), 0);
}

function isAutomatedResponseWithoutBookingDetails(input: MockThreadInput) {
  const subject = input.subject.toLowerCase();
  const haystack = threadSearchText(input).toLowerCase();
  const automated =
    AUTOMATED_RESPONSE_MARKERS.some((marker) => subject.includes(marker)) ||
    (input.messages.length === 1 &&
      AUTOMATED_RESPONSE_MARKERS.some((marker) => haystack.includes(marker)));
  if (!automated) return false;
  return countMarkers(haystack, BOOKING_DETAIL_MARKERS) < 2;
}

function firstEvidence(input: MockThreadInput, text: string, confidence: number) {
  const message = input.messages[0];
  return [
    {
      messageId: message?.gmailMessageId,
      text,
      confidence,
      locator: message ? `gmailMessageId:${message.gmailMessageId}` : "thread",
    },
  ];
}

async function createClassificationEvidence(
  tx: Prisma.TransactionClient,
  input: {
    eventId: string;
    messagesByGmailId: Map<string, string>;
    classification: ClassificationResult;
  },
) {
  for (const evidence of input.classification.evidence) {
    await createInboxEvidence(tx, {
      eventId: input.eventId,
      kind: InboxEvidenceKind.GMAIL_MESSAGE,
      gmailMessageId: evidence.messageId ? input.messagesByGmailId.get(evidence.messageId) : undefined,
      locator: evidence.locator,
      evidenceText: evidence.text,
      confidence: evidence.confidence,
      metadata: { classificationReason: input.classification.reason },
    });
  }
}

function buildExtractedFields(
  input: MockThreadInput,
  persistedMessages: Array<{ id: string; gmailMessageId: string }>,
  classificationReason: string,
  now: Date,
  extractionMetadata: Record<string, unknown> = {},
) {
  const persistedMessageIdsByGmailId = new Map(
    persistedMessages.map((message) => [message.gmailMessageId, message.id]),
  );
  const customerMessage = input.messages.find((message) => !isPopupPearlAddress(message.from) || isNewBookingRequestNotification(message));
  const extraction = extractEventDetails({
    fallbackCustomerName: customerMessage?.from?.name,
    fallbackCustomerEmail: customerMessage?.from?.email,
    messages: input.messages.map<EventDetailsMessage>((message) => ({
      id: persistedMessageIdsByGmailId.get(message.gmailMessageId) ?? message.gmailMessageId,
      author: addressLabel(message.from),
      fromEmail: message.from?.email ?? null,
      isCustomer: !isPopupPearlAddress(message.from) || isNewBookingRequestNotification(message),
      body: messageText(message),
      attachments: message.attachments?.map((attachment) => ({
        filename: attachment.filename,
        mimeType: attachment.mimeType ?? null,
        sizeBytes: attachment.sizeBytes ?? null,
      })),
    })),
  });

  return jsonObject(
    {
      ...serializeEventDetailsExtraction(extraction, {
        sourceSubject: input.subject,
        classificationReason,
        extractedAt: now.toISOString(),
      }),
      ...extractionMetadata,
    },
  );
}

export function recommendedNextAction(status: InboxEventStatus, extractedFields?: Prisma.InputJsonObject) {
  const aiRecommendedNextAction = stringValue(extractedFields?.recommendedNextAction);
  if (aiRecommendedNextAction) return aiRecommendedNextAction;
  if (status === InboxEventStatus.NEEDS_REPLY) return "Draft or review the next customer reply.";
  if (status === InboxEventStatus.AWAITING_CUSTOMER) return "Wait for the customer to respond.";
  if (status === InboxEventStatus.INVOICE_READY) return "Review invoice readiness evidence manually.";
  if (status === InboxEventStatus.MANUAL_REVIEW) return "Review the thread manually before replying.";
  return "No next action.";
}

export function statusFromAgentOutput(status: InboxEventStatus, extractedFields: Prisma.InputJsonObject) {
  if (
    status === InboxEventStatus.AWAITING_CUSTOMER ||
    status === InboxEventStatus.FOLLOW_UP
  ) {
    return status;
  }

  if (isInvoiceReadyExtractedFields(extractedFields)) {
    return InboxEventStatus.INVOICE_READY;
  }

  const classificationReason = stringValue(extractedFields.classificationReason);
  if (classificationReason === "wordpress_booking_form_marker" || classificationReason === "new_booking_request_marker") {
    return InboxEventStatus.NEEDS_REPLY;
  }

  const category = stringValue(extractedFields.threadCategory);
  if (category && !isCustomerThreadCategory(category)) {
    return InboxEventStatus.MANUAL_REVIEW;
  }


  if (
    category === "customer_inquiry" ||
    category === "customer_followup"
  ) {
    return InboxEventStatus.NEEDS_REPLY;
  }

  return status;
}

function isCustomerThreadCategory(category: string) {
  return (
    category === "customer_inquiry" ||
    category === "customer_followup" ||
    category === "manual_review"
  );
}

export function isInvoiceReadyExtractedFields(value: Prisma.InputJsonObject) {
  const invoiceReadiness = value.invoiceReadiness;
  return (
    typeof invoiceReadiness === "object" &&
    invoiceReadiness !== null &&
    !Array.isArray(invoiceReadiness) &&
    "ready" in invoiceReadiness &&
    invoiceReadiness.ready === true
  );
}

export async function createAgentRunAudit(
  tx: Prisma.TransactionClient,
  input: {
    eventId: string;
    messagesByGmailId: Map<string, string>;
    extractedFields: Prisma.InputJsonObject;
    status: InboxEventStatus;
    actorId?: string;
  },
) {
  const extractionMethod = stringValue(input.extractedFields.extractionMethod);
  const threadCategory = stringValue(input.extractedFields.threadCategory);
  const aiModel = stringValue(input.extractedFields.aiModel);
  const aiError = stringValue(input.extractedFields.aiExtractionError);

  if (extractionMethod || threadCategory || aiError) {
    await createInboxAction(tx, {
      eventId: input.eventId,
      actorId: input.actorId,
      actionType: InboxActionType.CLASSIFIED,
      after: {
        extractionMethod,
        threadCategory,
        status: toUserFacingInboxStatus(input.status),
        aiModel,
        aiConfidence: input.extractedFields.aiConfidence,
        invoiceReadiness: input.extractedFields.invoiceReadiness,
        recommendedNextAction: input.extractedFields.recommendedNextAction,
        aiExtractionError: aiError,
      },
      note: aiError
        ? "Inbox agent fallback was recorded after AI extraction failed."
        : "Inbox agent classified the thread and extracted event details.",
    });
  }

  const fieldEvidence = Array.isArray(input.extractedFields.fieldEvidence)
    ? input.extractedFields.fieldEvidence
    : [];
  for (const item of fieldEvidence.slice(0, 8)) {
    if (!isRecord(item)) continue;
    const field = stringValue(item.field);
    const value = stringValue(item.value);
    if (!field || !value) continue;
    const sourceMessageId = stringValue(item.sourceMessageId);
    await createInboxEvidence(tx, {
      eventId: input.eventId,
      kind: InboxEvidenceKind.EXTRACTED_FIELD,
      gmailMessageId: sourceMessageId
        ? input.messagesByGmailId.get(sourceMessageId)
        : undefined,
      locator: field,
      evidenceText: `${field}: ${value}`,
      confidence: typeof item.confidence === "number" ? item.confidence : undefined,
      metadata: {
        sourceSnippet: stringValue(item.sourceSnippet),
        extractionMethod,
        threadCategory,
      },
    });
  }
}

function latestMessageDate(messages: MockMessageInput[]) {
  const timestamps = messages
    .map((message) => toDate(message.sentAt) ?? toDate(message.internalDate))
    .filter((date): date is Date => Boolean(date))
    .map((date) => date.getTime());

  if (!timestamps.length) return undefined;
  return new Date(Math.max(...timestamps));
}

function messageData(input: MockMessageInput) {
  return {
    subject: input.subject,
    from: jsonObject(input.from),
    to: jsonArray(input.to),
    cc: jsonArray(input.cc),
    bcc: jsonArray(input.bcc),
    replyTo: jsonArray(input.replyTo),
    snippet: input.snippet,
    bodyPlain: input.bodyPlain,
    bodyHtml: input.bodyHtml,
    sentAt: toDate(input.sentAt),
    internalDate: toDate(input.internalDate),
    metadata: jsonObject(input.metadata),
  };
}

function attachmentData(input: MockAttachmentInput) {
  return {
    gmailAttachmentId: input.gmailAttachmentId,
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    contentId: input.contentId,
    storageRef: input.storageRef,
    metadata: jsonObject(input.metadata),
  };
}

function messageText(input: MockMessageInput) {
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

function addressLabel(address?: MockAddress) {
  return address?.name || address?.email || "Unknown sender";
}

function isPopupPearlAddress(address?: MockAddress) {
  const text = `${address?.name ?? ""} ${address?.email ?? ""}`.toLowerCase();
  if (text.includes("wordpress") || text.includes("wix") || text.includes("no-reply") || text.includes("noreply") || text.includes("website")) {
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

function toDate(value?: string | Date) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonObject(value?: Record<string, unknown> | MockAddress) {
  return (value ?? {}) as Prisma.InputJsonObject;
}

function jsonArray(value?: unknown[]) {
  return (value ?? []) as Prisma.InputJsonArray;
}

export async function autoTriageFollowUps(companyId: string) {
  const thresholdDays = Number(process.env.FOLLOW_UP_THRESHOLD_DAYS || 3);
  const thresholdDate = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);

  const candidates = await prisma.inboxEvent.findMany({
    where: {
      companyId,
      status: InboxEventStatus.AWAITING_CUSTOMER,
      thread: {
        latestMessageAt: {
          not: null,
          lte: thresholdDate,
        },
      },
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (candidates.length === 0) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const candidate of candidates) {
      await tx.inboxEvent.update({
        where: { id: candidate.id },
        data: {
          status: InboxEventStatus.FOLLOW_UP,
          recommendedNextAction: "Draft or send a follow-up check-in.",
        },
      });
      await createInboxAction(tx, {
        eventId: candidate.id,
        actionType: InboxActionType.STATUS_CHANGED,
        before: { status: toUserFacingInboxStatus(candidate.status) },
        after: { status: toUserFacingInboxStatus(InboxEventStatus.FOLLOW_UP) },
        note: `Automatically triaged to Follow-up because the last message was sent ${thresholdDays} or more days ago.`,
      });
    }
  });
  const { prepareInboxDraftForEvent, persistInboxDraftPlan } = await import("./draftGeneration");
  for (const candidate of candidates) {
    try {
      const prepared = await prepareInboxDraftForEvent(prisma, {
        eventId: candidate.id,
        companyId,
      });
      if (prepared.ok) {
        await prisma.$transaction(async (tx) => {
          await persistInboxDraftPlan(tx, {
            eventId: candidate.id,
            actorId: undefined,
            wasRegeneration: prepared.wasRegeneration,
            plan: prepared.plan,
          });
        });
      }
    } catch (draftErr) {
      console.error(`Failed to auto-generate follow-up draft for event ${candidate.id}:`, draftErr);
    }
  }
}
