import { InboxActionType, InboxEventStatus, BrainSourceType } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

import { requireMutationAuth } from "@/app/lib/apiAuth";
import { createInboxAction, toUserFacingInboxStatus } from "@/app/lib/inbox/manualImport";
import { prisma } from "@/lib/prisma";
import { generateCandidatesForSource } from "@/app/lib/brainCandidatePipeline";
import {
  databaseUnavailableResponse,
  getDefaultContext,
  hasDatabaseUrl,
} from "../../../../brain/_shared";

type StatusRouteContext = {
  params: Promise<{ eventId: string }>;
};

export async function POST(request: NextRequest, context: StatusRouteContext) {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();
  const unauthorized = await requireMutationAuth();
  if (unauthorized) return unauthorized;

  const { eventId } = await context.params;

  try {
    const body = await readBody(request);
    const nextStatus = statusForIntent(body.intent);
    if (!nextStatus) {
      return NextResponse.json({ error: "Unsupported status intent." }, { status: 400 });
    }

    const { company, reviewer } = await getDefaultContext();

    const result = await prisma.$transaction(async (tx) => {
      let localSourceDetails: { id: string; title: string; sourceType: BrainSourceType; rawText: string } | null = null;
      const existing = await tx.inboxEvent.findFirst({
        where: { id: eventId, companyId: company.id },
        select: { id: true, status: true },
      });

      if (!existing) {
        return { ok: false as const, status: 404, error: "Inbox event was not found." };
      }

      const event = await tx.inboxEvent.update({
        where: { id: eventId },
        data: {
          status: nextStatus,
          completedAt: nextStatus === InboxEventStatus.COMPLETE ? new Date() : null,
          recommendedNextAction: recommendedNextActionForStatus(nextStatus),
        },
      });

      if (nextStatus === InboxEventStatus.COMPLETE) {
        const fullEvent = await tx.inboxEvent.findUnique({
          where: { id: eventId },
          include: {
            thread: {
              include: {
                messages: {
                  orderBy: { sentAt: "asc" },
                },
              },
            },
          },
        });

        if (fullEvent && fullEvent.thread.messages.length > 0) {
          const threadText = fullEvent.thread.messages
            .map((m) => `From: ${JSON.stringify(m.from)}\nDate: ${m.sentAt}\nSubject: ${m.subject}\n\n${m.bodyPlain || m.snippet || ""}`)
            .join("\n\n---\n\n");

          const contentHash = createHash("sha256").update(threadText).digest("hex");

          const source = await tx.brainSource.upsert({
            where: {
              companyId_contentHash: {
                companyId: company.id,
                contentHash,
              },
            },
            create: {
              companyId: company.id,
              title: `Email Thread: ${fullEvent.thread.subject}`,
              sourceType: BrainSourceType.EMAIL_EXPORT,
              contentHash,
              rawText: threadText,
              metadata: {
                gmailThreadId: fullEvent.thread.gmailThreadId,
                eventId: fullEvent.id,
              },
            },
            update: {},
          });

          localSourceDetails = {
            id: source.id,
            title: source.title,
            sourceType: source.sourceType,
            rawText: source.rawText,
          };
        }
      }

      const reopenedFromArchive =
        existing.status === InboxEventStatus.COMPLETE &&
        nextStatus !== InboxEventStatus.COMPLETE;

      await createInboxAction(tx, {
        eventId,
        actorId: reviewer.id,
        actionType:
          reopenedFromArchive
            ? InboxActionType.REOPENED
            : nextStatus === InboxEventStatus.COMPLETE
            ? InboxActionType.MARKED_COMPLETE
            : InboxActionType.STATUS_CHANGED,
        before: { status: toUserFacingInboxStatus(existing.status) },
        after: {
          status: toUserFacingInboxStatus(event.status),
          closeState: body.closeState ?? "completed",
          triageIntent: body.intent,
        },
        note:
          reopenedFromArchive
            ? "Reopened from Archive locally. No Gmail action occurred."
            : nextStatus === InboxEventStatus.COMPLETE
            ? "Marked complete locally. No Gmail action occurred."
            : "Triage status changed locally. No Gmail action occurred.",
      });

      return { ok: true as const, event, sourceDetails: localSourceDetails };
    });

    if (result.ok && result.sourceDetails) {
      generateCandidatesForSource({
        companyId: company.id,
        sourceId: result.sourceDetails.id,
        sourceTitle: result.sourceDetails.title,
        sourceType: result.sourceDetails.sourceType,
        rawText: result.sourceDetails.rawText,
      }).catch((err) => {
        console.error("Failed to run ingestion feedback loop:", err);
      });
    }

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      event: {
        id: result.event.id,
        status: toUserFacingInboxStatus(result.event.status),
        recommendedNextAction: result.event.recommendedNextAction,
        completedAt: result.event.completedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Status update failed." },
      { status: 400 },
    );
  }
}

async function readBody(request: NextRequest): Promise<{
  intent?: string;
  closeState?: string;
}> {
  const text = await request.text();
  if (!text.trim()) return {};
  return JSON.parse(text) as { intent?: string; closeState?: string };
}

function statusForIntent(intent: string | undefined) {
  if (intent === "complete") return InboxEventStatus.COMPLETE;
  if (intent === "reopen") return InboxEventStatus.NEEDS_REPLY;
  if (intent === "needs_reply") return InboxEventStatus.NEEDS_REPLY;
  if (intent === "awaiting_customer") return InboxEventStatus.AWAITING_CUSTOMER;
  if (intent === "manual_review") return InboxEventStatus.MANUAL_REVIEW;
  if (intent === "invoice_ready") return InboxEventStatus.INVOICE_READY;
  if (intent === "follow_up") return InboxEventStatus.FOLLOW_UP;
  return null;
}

function recommendedNextActionForStatus(status: InboxEventStatus) {
  if (status === InboxEventStatus.NEEDS_REPLY) return "Review or generate the next customer reply.";
  if (status === InboxEventStatus.AWAITING_CUSTOMER) return "Wait for the customer to respond.";
  if (status === InboxEventStatus.MANUAL_REVIEW) return "Review and triage this thread manually.";
  if (status === InboxEventStatus.INVOICE_READY) return "Review invoice readiness evidence manually.";
  if (status === InboxEventStatus.FOLLOW_UP) return "Draft or send a follow-up check-in.";
  return "No next action.";
}
