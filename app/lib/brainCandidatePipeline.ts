import { BrainReviewAction, BrainReviewStatus, BrainSourceType } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { extractCandidatesForSource } from "@/app/lib/brainExtraction";
import { prisma } from "@/lib/prisma";

export async function generateCandidatesForSource(input: {
  companyId: string;
  sourceId: string;
  sourceTitle: string;
  sourceType: BrainSourceType;
  rawText: string;
  extractedText?: string | null;
}) {
  const extracted = await extractCandidatesForSource({
    sourceType: input.sourceType,
    title: input.sourceTitle,
    rawText: input.rawText,
    extractedText: input.extractedText,
  });

  let createdCount = 0;
  await prisma.$transaction(async (tx) => {
    for (const item of extracted) {
      const existing = await tx.brainCandidate.findFirst({
        where: {
          companyId: input.companyId,
          title: item.title,
          body: item.body,
          status: BrainReviewStatus.PENDING,
          sources: { some: { sourceId: input.sourceId } },
        },
      });
      if (existing) continue;

      const candidate = await tx.brainCandidate.create({
        data: {
          companyId: input.companyId,
          kind: item.kind,
          section: item.section,
          title: item.title,
          body: item.body,
          structuredData: (item.structuredData ?? {}) as Prisma.InputJsonValue,
          confidence: item.confidence,
          extractedBy: item.extractedBy,
          status: BrainReviewStatus.PENDING,
          sources: {
            create: {
              sourceId: input.sourceId,
              locator: item.locator,
              evidence: item.evidence,
            },
          },
        },
      });
      createdCount += 1;

      await tx.brainReviewEvent.create({
        data: {
          companyId: input.companyId,
          candidateId: candidate.id,
          action: BrainReviewAction.CREATED,
          toStatus: BrainReviewStatus.PENDING,
          note: `Extracted from source ${input.sourceTitle}`,
        },
      });
    }
  });

  return createdCount;
}
