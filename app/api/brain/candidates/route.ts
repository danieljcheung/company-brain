import { BrainReviewStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  databaseUnavailableResponse,
  getDefaultContext,
  hasDatabaseUrl,
  mapKindLabel,
  mapSectionLabel,
  mapSourceTypeLabel,
  mapStatusLabel,
} from "../_shared";

export async function GET(request: NextRequest) {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();
  const statusFilter = request.nextUrl.searchParams.get("status");
  const { company } = await getDefaultContext();

  const where =
    statusFilter === "open"
      ? { companyId: company.id, status: { in: [BrainReviewStatus.PENDING, BrainReviewStatus.NEEDS_CLARIFICATION] } }
      : statusFilter && statusFilter in BrainReviewStatus
        ? { companyId: company.id, status: statusFilter as BrainReviewStatus }
        : { companyId: company.id };

  const statusCounts = await prisma.brainCandidate.groupBy({
    by: ["status"],
    where: { companyId: company.id },
    _count: { _all: true },
  });

  const candidates = await prisma.brainCandidate.findMany({
    where,
    orderBy: { createdAt: "asc" },
    include: {
      sources: {
        include: {
          source: {
            select: {
              id: true,
              title: true,
              sourceType: true,
              importedAt: true,
              contentHash: true,
            },
          },
        },
      },
    },
  });

  return NextResponse.json({
    counts: Object.fromEntries(statusCounts.map((item) => [item.status, item._count._all])),
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      kind: candidate.kind,
      kindLabel: mapKindLabel(candidate.kind),
      section: candidate.section,
      sectionLabel: mapSectionLabel(candidate.section),
      title: candidate.title,
      body: candidate.body,
      confidence: candidate.confidence,
      status: candidate.status,
      statusLabel: mapStatusLabel(candidate.status),
      extractedBy: candidate.extractedBy,
      createdAt: candidate.createdAt,
      reviewedAt: candidate.reviewedAt,
      provenance: candidate.sources.map((item) => ({
        sourceId: item.sourceId,
        sourceTitle: item.source.title,
        sourceType: item.source.sourceType,
        sourceTypeLabel: mapSourceTypeLabel(item.source.sourceType),
        importedAt: item.source.importedAt,
        contentHash: item.source.contentHash,
        locator: item.locator,
        evidence: item.evidence,
      })),
    })),
  });
}
