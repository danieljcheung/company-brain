import { BrainReviewAction, BrainSection } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMutationAuth } from "@/app/lib/apiAuth";
import { databaseUnavailableResponse, getDefaultContext, hasDatabaseUrl } from "../../_shared";

type Params = { params: Promise<{ recordId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();
  const unauthorized = await requireMutationAuth();
  if (unauthorized) return unauthorized;
  const { recordId } = await params;
  const { company, reviewer } = await getDefaultContext();
  const body = (await request.json()) as {
    title?: string;
    body?: string;
    section?: string;
    note?: string;
  };

  const result = await prisma.$transaction(async (tx) => {
    const record = await tx.brainRecord.findFirst({
      where: { id: recordId, companyId: company.id },
      include: { sources: true },
    });
    if (!record) return { notFound: true as const };

    const nextTitle = body.title?.trim() || record.title;
    const nextBody = body.body?.trim() || record.body;
    const nextSection =
      body.section && body.section in BrainSection
        ? BrainSection[body.section as keyof typeof BrainSection]
        : record.section;

    const updated = await tx.brainRecord.update({
      where: { id: record.id },
      data: {
        title: nextTitle,
        body: nextBody,
        section: nextSection,
        currentVersion: { increment: 1 },
        reviewerId: reviewer.id,
      },
    });

    const version = await tx.brainVersion.create({
      data: {
        companyId: company.id,
        recordId: record.id,
        version: updated.currentVersion,
        title: updated.title,
        body: updated.body,
        data: toInputJson(updated.structuredData),
        actorId: reviewer.id,
        note: body.note ?? "Edited approved brain record.",
      },
    });

    for (const src of record.sources) {
      await tx.brainVersionSource.create({
        data: {
          versionId: version.id,
          sourceId: src.sourceId,
          locator: src.locator,
          evidence: src.evidence,
        },
      });
    }

    await tx.brainReviewEvent.create({
      data: {
        companyId: company.id,
        recordId: record.id,
        actorId: reviewer.id,
        action: BrainReviewAction.EDITED,
        fromStatus: record.status,
        toStatus: updated.status,
        note: body.note ?? null,
        before: { title: record.title, body: record.body, section: record.section },
        after: { title: updated.title, body: updated.body, section: updated.section },
      },
    });

    return { ok: true as const };
  });

  if ("notFound" in result) {
    return NextResponse.json({ error: "Record not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

function toInputJson(value: Prisma.JsonValue): Prisma.InputJsonValue {
  if (value === null) return {};
  return value as Prisma.InputJsonValue;
}
