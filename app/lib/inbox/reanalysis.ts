import {
  InboxActionType,
  InboxDraftStatus,
  InboxEventStatus,
  type GmailAttachment,
  type GmailMessage,
  type GmailThread,
  type Prisma,
} from "@prisma/client";

import { buildOpenAIExtractedFieldsForThread, hasOpenAIInboxAgent } from "./aiAgent";
import { loadApprovedBrainContextForDraft } from "./brainContext";
import {
  persistInboxDraftPlan,
  prepareInboxDraftForEvent,
  prepareStoredAgentDraftForEvent,
  isPopupPearlAddress,
  isNewBookingRequestNotification,
} from "./draftGeneration";
import {
  classifyMockThread,
  createAgentRunAudit,
  createInboxAction,
  isInvoiceReadyExtractedFields,
  recommendedNextAction,
  statusFromAgentOutput,
  toUserFacingInboxStatus,
  type MockAddress,
  type MockThreadInput,
} from "./manualImport";
import { prisma } from "@/lib/prisma";

type StoredThreadForAnalysis = GmailThread & {
  messages: Array<GmailMessage & { attachments: GmailAttachment[] }>;
};

export async function rerunInboxAgentForStoredEvent(input: {
  eventId: string;
  companyId: string;
  actorId?: string;
}) {
  const storedEvent = await prisma.inboxEvent.findFirst({
    where: { id: input.eventId, companyId: input.companyId },
    include: {
      drafts: {
        where: { status: InboxDraftStatus.DRAFT },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { id: true },
      },
      thread: {
        include: {
          messages: {
            orderBy: [{ sentAt: "asc" }, { createdAt: "asc" }],
            include: {
              attachments: {
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      },
    },
  });

  if (!storedEvent) {
    return { ok: false as const, status: 404, error: "Inbox event was not found." };
  }

  if (storedEvent.status === "COMPLETE") {
    return {
      ok: false as const,
      status: 409,
      error: "Archived inbox events cannot be reanalyzed. Reopen the thread first.",
    };
  }

  if (!storedEvent.thread.messages.length) {
    return {
      ok: false as const,
      status: 409,
      error: "This inbox event has no stored Gmail messages to analyze.",
    };
  }

  const threadInput = storedThreadToMockThread(storedEvent.thread);
  const classification = classifyMockThread(threadInput);
  const brainContext = await loadApprovedBrainContextForDraft(prisma, { companyId: input.companyId });
  const aiExtraction = await buildOpenAIExtractedFieldsForThread({
    thread: threadInput,
    classificationReason: classification.reason,
    approvedBrainRecords: brainContext,
  });
  let nextStatus = statusFromAgentOutput(storedEvent.status, aiExtraction.extractedFields);
  if (
    nextStatus === "INVOICE_READY" &&
    !isInvoiceReadyExtractedFields(aiExtraction.extractedFields)
  ) {
    nextStatus = "NEEDS_REPLY";
  }

  const latestMessage = storedEvent.thread.messages[storedEvent.thread.messages.length - 1];
  const isOurMessage =
    latestMessage
      ? isPopupPearlAddress(latestMessage.from) && !isNewBookingRequestNotification(latestMessage)
      : false;

  if (isOurMessage && nextStatus !== InboxEventStatus.INVOICE_READY) {
    const thresholdDays = Number(process.env.FOLLOW_UP_THRESHOLD_DAYS || 3);
    const thresholdDate = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);
    const latestMessageAt = storedEvent.thread.latestMessageAt;

    if (latestMessageAt && latestMessageAt <= thresholdDate) {
      nextStatus = InboxEventStatus.FOLLOW_UP;
    } else {
      nextStatus = InboxEventStatus.AWAITING_CUSTOMER;
    }
  }
  const nextAction = recommendedNextAction(nextStatus, aiExtraction.extractedFields);
  const wasRegeneration = storedEvent.drafts.length > 0;

  const updatedEvent = await prisma.$transaction(async (tx) => {
    const event = await tx.inboxEvent.update({
      where: { id: storedEvent.id },
      data: {
        status: nextStatus,
        extractedFields: aiExtraction.extractedFields,
        recommendedNextAction: nextAction,
        completedAt: nextStatus === "COMPLETE" ? new Date() : null,
      },
    });

    await createInboxAction(tx, {
      eventId: event.id,
      actorId: input.actorId,
      actionType:
        event.status === storedEvent.status
          ? InboxActionType.CLASSIFIED
          : InboxActionType.STATUS_CHANGED,
      before: {
        status: toUserFacingInboxStatus(storedEvent.status),
        extractionMethod: extractionMethod(storedEvent.extractedFields),
      },
      after: {
        status: toUserFacingInboxStatus(event.status),
        extractionMethod: extractionMethod(aiExtraction.extractedFields),
        threadCategory: stringValue(aiExtraction.extractedFields.threadCategory),
        aiModel: stringValue(aiExtraction.extractedFields.aiModel),
        aiExtractionAttempted: hasOpenAIInboxAgent(),
        aiExtractionError: aiExtraction.aiError,
      },
      note: "Manual inbox agent reanalysis ran on stored Gmail messages only. No Gmail action occurred.",
    });

    await createAgentRunAudit(tx, {
      eventId: event.id,
      actorId: input.actorId,
      messagesByGmailId: new Map(
        storedEvent.thread.messages.map((message) => [message.gmailMessageId, message.id]),
      ),
      extractedFields: aiExtraction.extractedFields,
      status: event.status,
    });

    return event;
  });

  const prepared = await prepareStoredAgentDraftForEvent(prisma, {
    eventId: updatedEvent.id,
    companyId: input.companyId,
  });
  const fallbackPrepared =
    !prepared.ok &&
    prepared.status === 204 &&
    !prepared.error.toLowerCase().includes("latest thread message is already from popup pearl")
      ? await prepareInboxDraftForEvent(prisma, {
          eventId: updatedEvent.id,
          companyId: input.companyId,
        })
      : prepared;

  const draftResult = fallbackPrepared.ok
    ? await prisma.$transaction((tx) =>
        persistInboxDraftPlan(tx, {
          eventId: fallbackPrepared.eventId,
          actorId: input.actorId,
          wasRegeneration: wasRegeneration || fallbackPrepared.wasRegeneration,
          plan: fallbackPrepared.plan,
        }),
      )
    : fallbackPrepared;

  if (!draftResult.ok && draftResult.status === 204) {
    const rejectedDrafts = await prisma.inboxDraft.updateMany({
      where: {
        eventId: updatedEvent.id,
        status: InboxDraftStatus.DRAFT,
      },
      data: {
        status: InboxDraftStatus.REJECTED,
        rejectedAt: new Date(),
        rejectedById: input.actorId,
        rejectionNote: draftResult.error,
      },
    });

    if (rejectedDrafts.count > 0) {
      await createInboxAction(prisma, {
        eventId: updatedEvent.id,
        actorId: input.actorId,
        actionType: InboxActionType.DRAFT_REJECTED,
        before: { status: InboxDraftStatus.DRAFT },
        after: { status: InboxDraftStatus.REJECTED },
        note: draftResult.error,
      });
    }
  }

  return {
    ok: true as const,
    event: {
      id: updatedEvent.id,
      status: toUserFacingInboxStatus(updatedEvent.status),
      recommendedNextAction: updatedEvent.recommendedNextAction,
      extractedFields: updatedEvent.extractedFields,
      updatedAt: updatedEvent.updatedAt.toISOString(),
    },
    draft:
      draftResult.ok
        ? {
            id: draftResult.draft.id,
            subject: draftResult.draft.subject,
            body: draftResult.draft.body,
            status: draftResult.draft.status,
            modelMetadata: draftResult.draft.modelMetadata,
            createdAt: draftResult.draft.createdAt.toISOString(),
            updatedAt: draftResult.draft.updatedAt.toISOString(),
          }
        : null,
    draftSkipped: draftResult.ok ? null : draftResult.error,
    aiExtractionAttempted: hasOpenAIInboxAgent(),
    aiExtractionError: aiExtraction.aiError,
  };
}

function storedThreadToMockThread(thread: StoredThreadForAnalysis): MockThreadInput {
  return {
    gmailThreadId: thread.gmailThreadId,
    subject: thread.subject,
    participants: readAddressArray(thread.participants),
    labels: readStringArray(thread.labels),
    isArchived: thread.isArchived,
    latestMessageAt: thread.latestMessageAt ?? undefined,
    metadata: readMetadata(thread.metadata),
    messages: thread.messages.map((message) => ({
      gmailMessageId: message.gmailMessageId,
      subject: message.subject ?? undefined,
      from: readAddress(message.from),
      to: readAddressArray(message.to),
      cc: readAddressArray(message.cc),
      bcc: readAddressArray(message.bcc),
      replyTo: readAddressArray(message.replyTo),
      snippet: message.snippet ?? undefined,
      bodyPlain: message.bodyPlain ?? undefined,
      bodyHtml: message.bodyHtml ?? undefined,
      sentAt: message.sentAt ?? undefined,
      internalDate: message.internalDate ?? undefined,
      metadata: readMetadata(message.metadata),
      attachments: message.attachments.map((attachment) => ({
        gmailAttachmentId: attachment.gmailAttachmentId ?? undefined,
        filename: attachment.filename,
        mimeType: attachment.mimeType ?? undefined,
        sizeBytes: attachment.sizeBytes ?? undefined,
        contentId: attachment.contentId ?? undefined,
        storageRef: attachment.storageRef ?? undefined,
        metadata: readMetadata(attachment.metadata),
      })),
    })),
  };
}

function readAddress(value: Prisma.JsonValue): MockAddress | undefined {
  if (!isRecord(value)) return undefined;
  return {
    name: stringValue(value.name) ?? undefined,
    email: stringValue(value.email) ?? undefined,
  };
}

function readAddressArray(value: Prisma.JsonValue): MockAddress[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const addresses = value.map(readAddress).filter((address): address is MockAddress => Boolean(address));
  return addresses.length ? addresses : undefined;
}

function readStringArray(value: Prisma.JsonValue): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length ? strings : undefined;
}

function readMetadata(value: Prisma.JsonValue): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return value as Record<string, unknown>;
}

function extractionMethod(value: unknown) {
  return isRecord(value) ? stringValue(value.extractionMethod) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
