import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  databaseUnavailableResponse,
  getDefaultContext,
  hasDatabaseUrl,
  requireApiAuth,
} from "../../brain/_shared";
import { toUserFacingInboxStatus, autoTriageFollowUps } from "@/app/lib/inbox/manualImport";
import { attachmentLifecycleStatus } from "@/app/lib/inbox/attachmentLifecycle";
import { isVisibleInboxAttachment } from "@/app/lib/inbox/visibleAttachments";

export async function GET(request: NextRequest) {
  const authResponse = await requireApiAuth(request);
  if (authResponse) return authResponse;
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();

  const { company } = await getDefaultContext();

  await autoTriageFollowUps(company.id);

  const summaryOnly = request.nextUrl.searchParams.get("summary") === "1";
  const eventId = request.nextUrl.searchParams.get("eventId");
  const limitParam = request.nextUrl.searchParams.get("limit");
  const offsetParam = request.nextUrl.searchParams.get("offset");
  const limit = eventId ? 1 : limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 200) : 50;
  const offset = eventId ? 0 : offsetParam ? Math.max(parseInt(offsetParam, 10), 0) : 0;

  const total = await prisma.inboxEvent.count({
    where: { companyId: company.id },
  });

  const events = await prisma.inboxEvent.findMany({
    where: { companyId: company.id, ...(eventId ? { id: eventId } : {}) },
    orderBy: { updatedAt: "desc" },
    skip: offset,
    take: limit,
    include: {
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
      actions: {
        orderBy: { createdAt: "desc" },
        take: summaryOnly ? 3 : 8,
      },
      drafts: {
        orderBy: { updatedAt: "desc" },
        take: summaryOnly ? 1 : 3,
        include: {
          evidence: {
            orderBy: { createdAt: "desc" },
            take: summaryOnly ? 0 : 8,
          },
        },
      },
      evidence: {
        orderBy: { createdAt: "desc" },
        take: summaryOnly ? 0 : 8,
      },
    },
  });

  return NextResponse.json({
    events: events.map((event) => ({
      id: event.id,
      status: toUserFacingInboxStatus(event.status),
      source: event.source,
      manualImport: event.manualImport,
      extractedFields: event.extractedFields,
      recommendedNextAction: event.recommendedNextAction,
      updatedAt: event.updatedAt.toISOString(),
      createdAt: event.createdAt.toISOString(),
      thread: {
        id: event.thread.id,
        gmailThreadId: event.thread.gmailThreadId,
        subject: event.thread.subject,
        isArchived: event.thread.isArchived,
        latestMessageAt: event.thread.latestMessageAt?.toISOString() ?? null,
        messageCount: event.thread.messages.length,
        firstSnippet: event.thread.messages[0]?.snippet ?? null,
        messages: (summaryOnly
          ? event.thread.messages.slice(-1)
          : event.thread.messages
        ).map((message) => ({
          id: message.id,
          gmailMessageId: message.gmailMessageId,
          subject: message.subject,
          from: message.from,
          to: summaryOnly ? null : message.to,
          cc: summaryOnly ? null : message.cc,
          snippet: message.snippet,
          bodyPlain: summaryOnly ? null : message.bodyPlain,
          bodyHtml: summaryOnly ? null : message.bodyPlain ? null : message.bodyHtml,
          sentAt: message.sentAt?.toISOString() ?? null,
          internalDate: message.internalDate?.toISOString() ?? null,
          attachments: message.attachments
            .filter(isVisibleInboxAttachment)
            .map((attachment) => ({
              id: attachment.id,
              filename: attachment.filename,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
              contentId: summaryOnly ? null : attachment.contentId,
              storageRef: summaryOnly ? null : attachment.storageRef,
              lifecycleStatus: attachmentLifecycleStatus(attachment.metadata),
            })),
        })),
      },
      actions: event.actions.map((action) => ({
        id: action.id,
        actionType: action.actionType,
        note: action.note,
        createdAt: action.createdAt.toISOString(),
      })),
      drafts: event.drafts.map((draft) => ({
        id: draft.id,
        subject: draft.subject,
        body: summaryOnly ? draft.body.slice(0, 280) : draft.body,
        status: draft.status,
        modelMetadata: summaryOnly ? null : draft.modelMetadata,
        createdAt: draft.createdAt.toISOString(),
        updatedAt: draft.updatedAt.toISOString(),
        evidence: draft.evidence.map((evidence) => ({
          id: evidence.id,
          kind: evidence.kind,
          evidenceText: evidence.evidenceText,
          confidence: evidence.confidence,
          locator: evidence.locator,
        })),
      })),
      evidence: event.evidence.map((evidence) => ({
        id: evidence.id,
        kind: evidence.kind,
        evidenceText: evidence.evidenceText,
        confidence: evidence.confidence,
        locator: evidence.locator,
      })),
    })),
    total,
    limit,
    offset,
  });
}
