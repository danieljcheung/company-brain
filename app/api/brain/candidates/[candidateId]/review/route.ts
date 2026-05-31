import { BrainReviewAction, BrainReviewStatus, BrainSection } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMutationAuth } from "@/app/lib/apiAuth";
import { databaseUnavailableResponse, getDefaultContext, hasDatabaseUrl } from "../../../_shared";

type Params = { params: Promise<{ candidateId: string }> };

type ReviewActionInput = "approve" | "reject" | "clarify" | "edit";
const REVIEW_ACTIONS = new Set<ReviewActionInput>(["approve", "reject", "clarify", "edit"]);

export async function POST(request: NextRequest, { params }: Params) {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();
  const unauthorized = await requireMutationAuth();
  if (unauthorized) return unauthorized;
  const { candidateId } = await params;
  const { company, reviewer } = await getDefaultContext();
  const body = (await request.json()) as Record<string, unknown>;
  const action = stringValue(body.action);
  if (!isReviewAction(action)) {
    return NextResponse.json(
      { error: "action must be one of: approve, reject, clarify, edit." },
      { status: 400 },
    );
  }

  const requestedSection = stringValue(body.section);
  if (requestedSection && !(requestedSection in BrainSection)) {
    return NextResponse.json({ error: "section is invalid." }, { status: 400 });
  }

  const input = {
    action,
    note: stringValue(body.note),
    title: stringValue(body.title),
    body: stringValue(body.body),
    section: requestedSection
      ? BrainSection[requestedSection as keyof typeof BrainSection]
      : undefined,
  };

  const result = await prisma.$transaction(async (tx) => {
    const candidate = await tx.brainCandidate.findFirst({
      where: { id: candidateId, companyId: company.id },
      include: { sources: true },
    });
    if (!candidate) return { notFound: true as const };

    const nextTitle = input.title ?? candidate.title;
    const nextBody = input.body ?? candidate.body;
    const nextSection = input.section ?? candidate.section;
    const fromStatus = candidate.status;
    if (
      input.action === "approve" &&
      candidate.status === BrainReviewStatus.APPROVED &&
      candidate.approvedRecordId
    ) {
      return { ok: true as const };
    }

    if (input.action === "edit") {
      if (
        candidate.title === nextTitle &&
        candidate.body === nextBody &&
        candidate.section === nextSection
      ) {
        return { ok: true as const };
      }
      const updated = await tx.brainCandidate.update({
        where: { id: candidate.id },
        data: { title: nextTitle, body: nextBody, section: nextSection },
      });
      await tx.brainReviewEvent.create({
        data: {
          companyId: company.id,
          candidateId: candidate.id,
          actorId: reviewer.id,
          action: BrainReviewAction.EDITED,
          fromStatus,
          toStatus: updated.status,
          note: input.note ?? "Candidate edited before review decision.",
          before: { title: candidate.title, body: candidate.body, section: candidate.section },
          after: { title: updated.title, body: updated.body, section: updated.section },
        },
      });
      return { ok: true as const };
    }

    if (input.action === "approve") {
      const approved = await tx.brainCandidate.update({
        where: { id: candidate.id },
        data: { title: nextTitle, body: nextBody, section: nextSection },
      });

      const record = await tx.brainRecord.create({
        data: {
          companyId: company.id,
          section: approved.section,
          title: approved.title,
          body: approved.body,
          structuredData: toInputJson(approved.structuredData),
          reviewerId: reviewer.id,
          approvedAt: new Date(),
          currentVersion: 1,
          status: BrainReviewStatus.APPROVED,
        },
      });

      for (const src of candidate.sources) {
        await tx.brainRecordSource.create({
          data: {
            recordId: record.id,
            sourceId: src.sourceId,
            locator: src.locator,
            evidence: src.evidence,
          },
        });
      }

      const version = await tx.brainVersion.create({
        data: {
          companyId: company.id,
          recordId: record.id,
          version: 1,
          title: record.title,
          body: record.body,
          data: toInputJson(record.structuredData),
          actorId: reviewer.id,
          note: input.note ?? "Approved from candidate review.",
        },
      });

      for (const src of candidate.sources) {
        await tx.brainVersionSource.create({
          data: {
            versionId: version.id,
            sourceId: src.sourceId,
            locator: src.locator,
            evidence: src.evidence,
          },
        });
      }

      await tx.brainCandidate.update({
        where: { id: candidate.id },
        data: {
          status: BrainReviewStatus.APPROVED,
          reviewedAt: new Date(),
          approvedRecordId: record.id,
        },
      });

      await tx.brainReviewEvent.create({
        data: {
          companyId: company.id,
          candidateId: candidate.id,
          recordId: record.id,
          actorId: reviewer.id,
          action: BrainReviewAction.APPROVED,
          fromStatus,
          toStatus: BrainReviewStatus.APPROVED,
          note: input.note ?? null,
          before: { title: candidate.title, body: candidate.body, section: candidate.section },
          after: { title: approved.title, body: approved.body, section: approved.section },
        },
      });

      return { ok: true as const };
    }

    const toStatus =
      input.action === "reject"
        ? BrainReviewStatus.REJECTED
        : BrainReviewStatus.NEEDS_CLARIFICATION;
    const action =
      input.action === "reject"
        ? BrainReviewAction.REJECTED
        : BrainReviewAction.NEEDS_CLARIFICATION;

    if (
      candidate.status === toStatus &&
      candidate.title === nextTitle &&
      candidate.body === nextBody &&
      candidate.section === nextSection
    ) {
      return { ok: true as const };
    }

    await tx.brainCandidate.update({
      where: { id: candidate.id },
      data: {
        status: toStatus,
        reviewedAt: new Date(),
        title: nextTitle,
        body: nextBody,
        section: nextSection,
      },
    });
    await tx.brainReviewEvent.create({
      data: {
        companyId: company.id,
        candidateId: candidate.id,
        actorId: reviewer.id,
        action,
        fromStatus,
        toStatus,
        note: input.note ?? null,
        before: { title: candidate.title, body: candidate.body, section: candidate.section },
        after: { title: nextTitle, body: nextBody, section: nextSection },
      },
    });

    return { ok: true as const };
  });

  if ("notFound" in result) {
    return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

function isReviewAction(value: string | null): value is ReviewActionInput {
  return value !== null && REVIEW_ACTIONS.has(value as ReviewActionInput);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toInputJson(value: Prisma.JsonValue): Prisma.InputJsonValue {
  if (value === null) return {};
  return value as Prisma.InputJsonValue;
}
