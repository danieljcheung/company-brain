import { InboxActionType, type Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { databaseUnavailableResponse, getDefaultContext, hasDatabaseUrl } from "../../../../brain/_shared";
import { requireMutationAuth } from "@/app/lib/apiAuth";
import { createInboxAction } from "@/app/lib/inbox/manualImport";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ eventId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();
  const unauthorized = await requireMutationAuth();
  if (unauthorized) return unauthorized;

  const { eventId } = await context.params;
  const { company, reviewer } = await getDefaultContext();
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "Thread title is required." }, { status: 400 });
  }
  if (title.length > 120) {
    return NextResponse.json({ error: "Thread title must be 120 characters or fewer." }, { status: 400 });
  }

  const existing = await prisma.inboxEvent.findFirst({
    where: { id: eventId, companyId: company.id },
    select: { id: true, extractedFields: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Inbox event was not found." }, { status: 404 });
  }

  const extractedFields = isRecord(existing.extractedFields) ? existing.extractedFields : {};
  const previousThreadTitle = isRecord(extractedFields.threadTitle) ? extractedFields.threadTitle : null;
  const nextThreadTitle = {
    title,
    rationale: "Edited manually in Company Brain inbox.",
    source: "manual_inbox_title_edit",
    editedAt: new Date().toISOString(),
    editedById: reviewer.id,
  };

  await prisma.$transaction(async (tx) => {
    await tx.inboxEvent.update({
      where: { id: existing.id },
      data: {
        extractedFields: {
          ...extractedFields,
          threadTitle: nextThreadTitle,
        } as Prisma.InputJsonObject,
      },
    });
    await createInboxAction(tx, {
      eventId: existing.id,
      actorId: reviewer.id,
      actionType: InboxActionType.STATUS_CHANGED,
      before: { threadTitle: previousThreadTitle },
      after: { threadTitle: nextThreadTitle },
      note: "Edited inbox thread title.",
    });
  });

  return NextResponse.json({ ok: true, threadTitle: nextThreadTitle });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
