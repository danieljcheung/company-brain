import { GmailSyncRunStatus, type GmailConnection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  fetchGmailThread,
  getConnectedGmailConnection,
  getReadOnlyGmailAccessToken,
  markConnectionError,
} from "@/app/lib/integrations/gmail/client";
import { normalizeGmailThread } from "@/app/lib/integrations/gmail/normalize";
import { buildOpenAIExtractedFieldsForThread, hasOpenAIInboxAgent } from "./aiAgent";
import { loadApprovedBrainContextForDraft } from "./brainContext";
import {
  persistInboxDraftPlan,
  prepareInboxDraftForEvent,
  prepareStoredAgentDraftForEvent,
} from "./draftGeneration";
import {
  classifyMockThread,
  createInboxEventFromMockThread,
  toUserFacingInboxStatus,
} from "./manualImport";

export type ImportSelectedGmailThreadInput = {
  companyId: string;
  actorId?: string;
  gmailThreadId: string;
  force?: boolean;
  note?: string;
  origin?: string;
};

export async function importSelectedGmailThread(input: ImportSelectedGmailThreadInput) {
  const syncRun = await prisma.gmailSyncRun.create({
    data: {
      companyId: input.companyId,
      status: GmailSyncRunStatus.RUNNING,
      metadata: {
        mode: "manual_selected_thread_import",
        gmailThreadId: input.gmailThreadId,
      },
    },
  });

  let connection: GmailConnection | null = null;
  try {
    connection = await getConnectedGmailConnection(input.companyId);
    if (!connection) {
      throw new Error("Shared Gmail is not connected. Connect read-only Gmail in Settings first.");
    }

    await prisma.gmailSyncRun.update({
      where: { id: syncRun.id },
      data: { connectionId: connection.id },
    });

    const accessToken = await getReadOnlyGmailAccessToken(connection, input.origin);
    const gmailThread = await fetchGmailThread(accessToken, input.gmailThreadId);
    const normalizedThread = normalizeGmailThread(gmailThread);
    const classification = classifyMockThread(normalizedThread);
    const brainContext = await loadApprovedBrainContextForDraft(prisma, { companyId: input.companyId });
    const aiExtraction = await buildOpenAIExtractedFieldsForThread({
      thread: normalizedThread,
      classificationReason: classification.reason,
      approvedBrainRecords: brainContext,
    });
    const attachmentCount = normalizedThread.messages.reduce(
      (count, message) => count + (message.attachments?.length ?? 0),
      0,
    );

    const importResult = await prisma.$transaction((tx) =>
      createInboxEventFromMockThread(tx, normalizedThread, {
        companyId: input.companyId,
        actorId: input.actorId,
        force: input.force ?? true,
        note: input.note ?? "Phase 3 Gmail selected-thread import.",
        extractedFieldsOverride: aiExtraction.extractedFields,
      }),
    );
    const draftResult = importResult.created
      ? await generateLocalDraftFromAgentOutput({
          eventId: importResult.event.id,
          companyId: input.companyId,
          actorId: input.actorId,
        })
      : null;

    await prisma.gmailSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: GmailSyncRunStatus.SUCCEEDED,
        completedAt: new Date(),
        threadsScanned: 1,
        threadsMatched: importResult.created ? 1 : 0,
        messagesSynced: normalizedThread.messages.length,
        attachmentsSynced: attachmentCount,
        cursorAfter: gmailThread.historyId,
        metadata: {
          mode: "manual_selected_thread_import",
          gmailThreadId: input.gmailThreadId,
          archived: normalizedThread.isArchived,
          createdEvent: importResult.created,
          classificationReason: importResult.classification.reason,
          aiExtractionAttempted: hasOpenAIInboxAgent(),
          aiExtractionError: aiExtraction.aiError,
          localDraftCreated: draftResult?.ok ?? false,
          localDraftSkipped: draftResult && !draftResult.ok ? draftResult.error : null,
        },
      },
    });

    await prisma.gmailConnection.update({
      where: { id: connection.id },
      data: {
        historyId: gmailThread.historyId ?? connection.historyId,
        lastSyncedAt: new Date(),
      },
    });

    return {
      syncRunId: syncRun.id,
      created: importResult.created,
      classification: importResult.classification,
      event: importResult.created
        ? {
            id: importResult.event.id,
            status: toUserFacingInboxStatus(importResult.event.status),
            source: importResult.event.source,
          }
        : null,
      thread: {
        gmailThreadId: normalizedThread.gmailThreadId,
        subject: normalizedThread.subject,
        messageCount: normalizedThread.messages.length,
        attachmentCount,
        isArchived: normalizedThread.isArchived,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail selected-thread import failed.";
    await prisma.gmailSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: GmailSyncRunStatus.FAILED,
        completedAt: new Date(),
        error: message,
      },
    });
    if (connection && isConnectionLevelGmailError(message)) {
      await markConnectionError(connection, message);
    }
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

function isConnectionLevelGmailError(message: string) {
  return /token|oauth|unauthorized|forbidden|invalid grant|access denied|permission|scope/i.test(
    message,
  );
}
