import { NextRequest, NextResponse } from "next/server";
import { requireMutationAuth } from "@/app/lib/apiAuth";

import {
  persistInboxDraftPlan,
  prepareInboxDraftForEvent,
  rejectLatestInboxDraft,
} from "@/app/lib/inbox/draftGeneration";
import { prisma } from "@/lib/prisma";
import {
  databaseUnavailableResponse,
  getDefaultContext,
  hasDatabaseUrl,
} from "../../../../brain/_shared";

type DraftRouteContext = {
  params: Promise<{ eventId: string }>;
};

export async function POST(request: NextRequest, context: DraftRouteContext) {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();
  const unauthorized = await requireMutationAuth();
  if (unauthorized) return unauthorized;

  const { eventId } = await context.params;

  try {
    const body = await readBody(request);
    const { company, reviewer } = await getDefaultContext();

    const result =
      body.intent === "reject"
        ? await prisma.$transaction((tx) =>
            rejectLatestInboxDraft(tx, {
              eventId,
              companyId: company.id,
              actorId: reviewer.id,
              note: body.note,
            }),
          )
        : await generateDraftOutsideLongTransaction({
            eventId,
            companyId: company.id,
            actorId: reviewer.id,
          });

    if (!result.ok) {
      if (result.status === 204) return new Response(null, { status: 204 });
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      draft: {
        id: result.draft.id,
        subject: result.draft.subject,
        body: result.draft.body,
        status: result.draft.status,
        modelMetadata: result.draft.modelMetadata,
        createdAt: result.draft.createdAt.toISOString(),
        updatedAt: result.draft.updatedAt.toISOString(),
      },
      actionType: "actionType" in result ? result.actionType : "DRAFT_REJECTED",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Draft action failed." },
      { status: 400 },
    );
  }
}

async function generateDraftOutsideLongTransaction(input: {
  eventId: string;
  companyId: string;
  actorId?: string;
}) {
  const prepared = await prepareInboxDraftForEvent(prisma, {
    eventId: input.eventId,
    companyId: input.companyId,
  });

  if (!prepared.ok) return prepared;

  return prisma.$transaction((tx) =>
    persistInboxDraftPlan(tx, {
      eventId: prepared.eventId,
      actorId: input.actorId,
      wasRegeneration: prepared.wasRegeneration,
      plan: prepared.plan,
    }),
  );
}

async function readBody(request: NextRequest): Promise<{
  intent?: "generate" | "regenerate" | "reject";
  note?: string;
}> {
  const text = await request.text();
  if (!text.trim()) return {};
  return JSON.parse(text) as {
    intent?: "generate" | "regenerate" | "reject";
    note?: string;
  };
}
