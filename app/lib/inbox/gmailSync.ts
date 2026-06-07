import {
  GmailSyncRunStatus,
  InboxActionType,
  InboxEventStatus,
  InboxEventSource,
  type GmailConnection,
  type InboxEvent,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  fetchGmailThread,
  getConnectedGmailConnection,
  getReadOnlyGmailAccessToken,
  listGmailThreads,
  markConnectionError,
} from "@/app/lib/integrations/gmail/client";
import { normalizeGmailThread } from "@/app/lib/integrations/gmail/normalize";
import { buildOpenAIExtractedFieldsForThread, hasOpenAIInboxAgent } from "./aiAgent";
import {
  persistInboxDraftPlan,
  prepareInboxDraftForEvent,
  prepareStoredAgentDraftForEvent,
  isNewBookingRequestNotification,
} from "./draftGeneration";
import { loadApprovedBrainContextForDraft } from "./brainContext";
import {
  classifyMockThread,
  createInboxAction,
  createInboxEventFromMockThread,
  toUserFacingInboxStatus,
  autoTriageFollowUps,
  type MockAddress,
  type MockMessageInput,
  type MockThreadInput,
} from "./manualImport";

const SYNC_WINDOW_DAYS = 31;
const DEFAULT_MAX_THREADS_PER_SYNC = 75;

export type SyncConservativeGmailInput = {
  companyId: string;
  actorId?: string;
  origin?: string;
};

type ExistingTrackedThread = {
  id: string;
  trackStatus: string;
  inboxEvent: InboxEvent | null;
  messages: Array<{
    gmailMessageId: string;
    sentAt: Date | null;
    internalDate: Date | null;
  }>;
};

export async function syncConservativeGmail(input: SyncConservativeGmailInput) {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd);
  windowStart.setDate(windowStart.getDate() - SYNC_WINDOW_DAYS);
  const maxThreadsPerSync = getMaxThreadsPerSync();

  const syncRun = await prisma.gmailSyncRun.create({
    data: {
      companyId: input.companyId,
      status: GmailSyncRunStatus.RUNNING,
      syncWindowStart: windowStart,
      syncWindowEnd: windowEnd,
      metadata: {
        mode: "conservative_manual_sync",
        query: "newer_than:1m",
        maxThreads: maxThreadsPerSync,
      },
    },
  });

  let connection: GmailConnection | null = null;
  let threadsScanned = 0;
  let threadsMatched = 0;
  let messagesSynced = 0;
  let attachmentsSynced = 0;
  let threadsSkippedArchived = 0;
  let threadsSkippedUnmatched = 0;
  let eventsReopened = 0;
  let draftsCreated = 0;
  let draftsSkipped = 0;
  const errors: Array<{ gmailThreadId?: string; message: string }> = [];
  const aiExtractionErrors: Array<{ gmailThreadId: string; message: string }> = [];

  try {
    connection = await getConnectedGmailConnection(input.companyId);
    if (!connection) {
      throw new Error("Shared Gmail is not connected. Connect read-only Gmail in Settings first.");
    }

    await prisma.gmailSyncRun.update({
      where: { id: syncRun.id },
      data: { connectionId: connection.id, cursorBefore: connection.historyId },
    });

    const accessToken = await getReadOnlyGmailAccessToken(connection, input.origin);
    const listedThreads = await listRecentThreadIds(accessToken, maxThreadsPerSync);
    let newestHistoryId = connection.historyId;

    const brainContext = await loadApprovedBrainContextForDraft(prisma, { companyId: input.companyId });
    for (const listedThread of listedThreads) {
      threadsScanned += 1;

      try {
        const existing = await findExistingTrackedThread(input.companyId, listedThread.id);
        const gmailThread = await fetchGmailThread(accessToken, listedThread.id);
        const normalizedThread = normalizeGmailThread(gmailThread);
        newestHistoryId = gmailThread.historyId ?? newestHistoryId;

        const existingMessageIds = new Set(existing?.messages.map((m) => m.gmailMessageId) ?? []);
        const hasNewMessages = normalizedThread.messages.some((m) => !existingMessageIds.has(m.gmailMessageId));
        if (existing && !hasNewMessages) {
          // Unchanged thread. Skip expensive AI analysis and database transactions.
          continue;
        }
        if (normalizedThread.isArchived && !existing?.inboxEvent) {
          threadsSkippedArchived += 1;
          continue;
        }

        const classification = classifyMockThread(normalizedThread);
        const aiExtraction = await buildOpenAIExtractedFieldsForThread({
          thread: normalizedThread,
          classificationReason: classification.reason,
          approvedBrainRecords: brainContext,
        });
        if (aiExtraction.aiError) {
          aiExtractionErrors.push({
            gmailThreadId: listedThread.id,
            message: aiExtraction.aiError,
          });
        }
        const agentCategory = extractedThreadCategory(aiExtraction.extractedFields);
        const syncDecision = decisionForAgentClassifiedThread({
          agentCategory,
          classificationShouldCreate: classification.shouldCreate,
          hasExistingEvent: Boolean(existing?.inboxEvent),
        });
        if (!syncDecision.shouldImport) {
          threadsSkippedUnmatched += 1;
          continue;
        }

        const isAutomatedForm = classification.shouldCreate &&
          (classification.source === InboxEventSource.WORDPRESS_BOOKING_FORM ||
           classification.source === InboxEventSource.NEW_BOOKING_REQUEST);

        const latestMessageFromPopupPearl = isAutomatedForm
          ? false
          : latestThreadMessageIsPopupPearl(normalizedThread);
        const statusOverride = latestMessageFromPopupPearl
          ? InboxEventStatus.AWAITING_CUSTOMER
          : syncDecision.requestedStatus ?? statusForSyncImport(existing, normalizedThread);
        const extractedFields = latestMessageFromPopupPearl
          ? extractedFieldsForAwaitingCustomer(aiExtraction.extractedFields)
          : aiExtraction.extractedFields;
        const importResult = await prisma.$transaction(async (tx) => {
          const result = await createInboxEventFromMockThread(tx, normalizedThread, {
            companyId: input.companyId,
            actorId: input.actorId,
            force: syncDecision.force,
            requestedStatus: statusOverride
              ? toUserFacingInboxStatus(statusOverride)
              : undefined,
            note: "Conservative Gmail sync.",
            extractedFieldsOverride: extractedFields,
          });

          if (
            result.created &&
            existing?.inboxEvent &&
            existing.inboxEvent.status !== InboxEventStatus.NEEDS_REPLY &&
            statusOverride === InboxEventStatus.NEEDS_REPLY
          ) {
            await createInboxAction(tx, {
              eventId: result.event.id,
              actorId: input.actorId,
              actionType: InboxActionType.REOPENED,
              before: { status: toUserFacingInboxStatus(existing.inboxEvent.status) },
              after: { status: "needs_reply" },
              note: "Reopened by Gmail sync after a new customer reply.",
            });
          }

          return result;
        });

        if (!importResult.created) {
          threadsSkippedUnmatched += 1;
          continue;
        }

        const draftResult = await generateLocalDraftFromAgentOutput({
          eventId: importResult.event.id,
          companyId: input.companyId,
          actorId: input.actorId,
        });
        if (draftResult.ok) {
          draftsCreated += 1;
        } else {
          draftsSkipped += 1;
        }

        threadsMatched += 1;
        messagesSynced += normalizedThread.messages.length;
        attachmentsSynced += normalizedThread.messages.reduce(
          (count, message) => count + (message.attachments?.length ?? 0),
          0,
        );
        if (
          existing?.inboxEvent &&
          existing.inboxEvent.status !== InboxEventStatus.NEEDS_REPLY &&
          statusOverride === InboxEventStatus.NEEDS_REPLY
        ) {
          eventsReopened += 1;
        }
      } catch (error) {
        errors.push({
          gmailThreadId: listedThread.id,
          message: error instanceof Error ? error.message : "Thread sync failed.",
        });
      }
    }

    await prisma.gmailSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: GmailSyncRunStatus.SUCCEEDED,
        completedAt: new Date(),
        threadsScanned,
        threadsMatched,
        messagesSynced,
        attachmentsSynced,
        cursorAfter: newestHistoryId,
        error: errors.length ? `${errors.length} thread(s) failed during sync.` : null,
        metadata: {
          mode: "conservative_manual_sync",
          query: "newer_than:1m",
          maxThreads: maxThreadsPerSync,
          listedThreads: listedThreads.length,
          threadsSkippedArchived,
          threadsSkippedUnmatched,
          eventsReopened,
          draftsCreated,
          draftsSkipped,
          aiExtractionAttempted: hasOpenAIInboxAgent(),
          aiExtractionErrors,
          errors,
        },
      },
    });

    await prisma.gmailConnection.update({
      where: { id: connection.id },
      data: {
        historyId: newestHistoryId,
        lastSyncedAt: new Date(),
      },
    });
    try {
      await autoTriageFollowUps(input.companyId);
    } catch (autoErr) {
      console.error("Failed to run autoTriageFollowUps during sync:", autoErr);
    }
    return {
      syncRunId: syncRun.id,
      status: "succeeded" as const,
      threadsScanned,
      threadsMatched,
      messagesSynced,
      attachmentsSynced,
      threadsSkippedArchived,
      threadsSkippedUnmatched,
      eventsReopened,
      errors,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Conservative Gmail sync failed.";
    await prisma.gmailSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: GmailSyncRunStatus.FAILED,
        completedAt: new Date(),
        threadsScanned,
        threadsMatched,
        messagesSynced,
        attachmentsSynced,
        error: message,
        metadata: {
          mode: "conservative_manual_sync",
          query: "newer_than:1m",
          maxThreads: maxThreadsPerSync,
          threadsSkippedArchived,
          threadsSkippedUnmatched,
          eventsReopened,
          draftsCreated,
          draftsSkipped,
          aiExtractionAttempted: hasOpenAIInboxAgent(),
          aiExtractionErrors,
          errors,
        },
      },
    });
    if (connection) await markConnectionError(connection, message);
    throw error;
  }
}

async function generateLocalDraftFromAgentOutput(input: {
  eventId: string;
  companyId: string;
  actorId?: string;
}) {
  const prepared = await prepareStoredAgentDraftForEvent(prisma, {
    eventId: input.eventId,
    companyId: input.companyId,
  });
  const fallbackPrepared =
    !prepared.ok && prepared.status === 204
      ? await prepareInboxDraftForEvent(prisma, {
          eventId: input.eventId,
          companyId: input.companyId,
        })
      : prepared;

  if (!fallbackPrepared.ok) return fallbackPrepared;

  return prisma.$transaction((tx) =>
    persistInboxDraftPlan(tx, {
      eventId: fallbackPrepared.eventId,
      actorId: input.actorId,
      wasRegeneration: fallbackPrepared.wasRegeneration,
      plan: fallbackPrepared.plan,
    }),
  );
}

async function listRecentThreadIds(accessToken: string, maxThreadsPerSync: number) {
  const threads: Array<{ id: string; historyId?: string }> = [];
  let pageToken: string | undefined;

  do {
    const remaining = maxThreadsPerSync - threads.length;
    if (remaining <= 0) break;
    const page = await listGmailThreads(accessToken, {
      query: "newer_than:1m",
      maxResults: Math.min(remaining, 50),
      pageToken,
    });
    for (const thread of page.threads ?? []) {
      if (thread.id) threads.push({ id: thread.id, historyId: thread.historyId });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  return threads;
}

function getMaxThreadsPerSync() {
  const parsed = Number.parseInt(process.env.GMAIL_SYNC_MAX_THREADS ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_THREADS_PER_SYNC;
}

async function findExistingTrackedThread(companyId: string, gmailThreadId: string) {
  return prisma.gmailThread.findUnique({
    where: {
      companyId_gmailThreadId: {
        companyId,
        gmailThreadId,
      },
    },
    include: {
      inboxEvent: true,
      messages: {
        select: {
          gmailMessageId: true,
          sentAt: true,
          internalDate: true,
        },
      },
    },
  }) as Promise<ExistingTrackedThread | null>;
}

function statusForSyncImport(
  existing: ExistingTrackedThread | null,
  normalizedThread: MockThreadInput,
) {
  if (!existing?.inboxEvent) return undefined;

  if (hasNewCustomerReply(existing, normalizedThread)) {
    return InboxEventStatus.NEEDS_REPLY;
  }

  return existing.inboxEvent.status;
}

function hasNewCustomerReply(existing: ExistingTrackedThread, normalizedThread: MockThreadInput) {
  const oldMessageIds = new Set(existing.messages.map((message) => message.gmailMessageId));
  const previousLatestAt = latestExistingMessageAt(existing);

  return normalizedThread.messages.some((message) => {
    if (!isCustomerMessage(message)) return false;
    if (oldMessageIds.has(message.gmailMessageId)) return false;
    const messageAt = messageDate(message);
    return !previousLatestAt || !messageAt || messageAt.getTime() >= previousLatestAt.getTime();
  });
}

function latestExistingMessageAt(existing: ExistingTrackedThread) {
  const timestamps = existing.messages
    .map((message) => message.sentAt ?? message.internalDate)
    .filter((date): date is Date => Boolean(date))
    .map((date) => date.getTime());
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps));
}

function messageDate(message: MockMessageInput) {
  const value = message.sentAt ?? message.internalDate;
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function isCustomerMessage(message: MockMessageInput) {
  return !isPopupPearlAddress(message.from) || isNewBookingRequestNotification(message);
}

function latestThreadMessageIsPopupPearl(thread: MockThreadInput) {
  const latestMessage = thread.messages[thread.messages.length - 1];
  return latestMessage
    ? isPopupPearlAddress(latestMessage.from) && !isNewBookingRequestNotification(latestMessage)
    : false;
}

function isPopupPearlAddress(address?: MockAddress) {
  const text = `${address?.name ?? ""} ${address?.email ?? ""}`.toLowerCase();
  if (text.includes("wordpress") || text.includes("wix") || text.includes("no-reply") || text.includes("noreply") || text.includes("website")) {
    return false;
  }
  return (
    text.includes("popup pearl") ||
    text.includes("pop-up pearl") ||
    text.includes("popuppearl") ||
    text.includes("popup-pearl")
  );
}

function extractedThreadCategory(extractedFields?: Record<string, unknown>) {
  const value = extractedFields?.threadCategory;
  return typeof value === "string" ? value : null;
}

function extractedFieldsForAwaitingCustomer(extractedFields: Record<string, unknown>) {
  return {
    ...extractedFields,
    draft: null,
    asksCustomerToConfirm: false,
    recommendedNextAction: "Wait for the customer to respond.",
  };
}

function decisionForAgentClassifiedThread(input: {
  agentCategory: string | null;
  classificationShouldCreate: boolean;
  hasExistingEvent: boolean;
}) {
  if (input.hasExistingEvent || input.classificationShouldCreate) {
    return { shouldImport: true, force: false, requestedStatus: undefined };
  }

  if (
    input.agentCategory === "customer_inquiry" ||
    input.agentCategory === "customer_followup"
  ) {
    return { shouldImport: true, force: true, requestedStatus: undefined };
  }

  if (input.agentCategory === "manual_review") {
    return {
      shouldImport: true,
      force: true,
      requestedStatus: InboxEventStatus.MANUAL_REVIEW,
    };
  }

  return { shouldImport: false, force: false, requestedStatus: undefined };
}
