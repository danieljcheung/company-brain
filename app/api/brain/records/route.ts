import { BrainReviewStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  databaseUnavailableResponse,
  getDefaultContext,
  hasDatabaseUrl,
  mapSectionLabel,
  mapSourceTypeLabel,
} from "../_shared";

export async function GET() {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();
  const { company } = await getDefaultContext();
  const records = await prisma.brainRecord.findMany({
    where: { companyId: company.id, status: BrainReviewStatus.APPROVED },
    orderBy: { approvedAt: "desc" },
    include: {
      reviewer: true,
      reviewEvents: {
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { actor: true },
      },
      questions: {
        orderBy: { updatedAt: "desc" },
        take: 3,
      },
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
    records: records.map((record) => ({
      id: record.id,
      section: record.section,
      sectionLabel: mapSectionLabel(record.section),
      title: record.title,
      body: record.body,
      structuredData: record.structuredData,
      reviewer: record.reviewer?.name ?? "Unknown reviewer",
      approvedAt: record.approvedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      version: record.currentVersion,
      supersedesId: record.supersedesId,
      questions: record.questions.map((question) => ({
        id: question.id,
        title: question.title,
        body: question.body,
        status: question.status,
        answer: question.answer,
        answeredAt: question.answeredAt,
        updatedAt: question.updatedAt,
      })),
      timeline: record.reviewEvents.map((event) => ({
        id: event.id,
        action: event.action,
        actor: event.actor?.name ?? "System",
        note: event.note,
        createdAt: event.createdAt,
      })),
      provenance: record.sources.map((item) => ({
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
