import { NextRequest, NextResponse } from "next/server";
import { generateCandidatesForSource } from "@/app/lib/brainCandidatePipeline";
import { requireMutationAuth } from "@/app/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import { databaseUnavailableResponse, getDefaultContext, hasDatabaseUrl } from "../../../_shared";

type Params = { params: Promise<{ sourceId: string }> };

export async function POST(_: NextRequest, { params }: Params) {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();
  const unauthorized = await requireMutationAuth();
  if (unauthorized) return unauthorized;
  const { sourceId } = await params;
  const { company } = await getDefaultContext();

  const source = await prisma.brainSource.findFirst({
    where: { id: sourceId, companyId: company.id },
  });
  if (!source) return NextResponse.json({ error: "Source not found." }, { status: 404 });

  const createdCount = await generateCandidatesForSource({
    companyId: company.id,
    sourceId,
    sourceTitle: source.title,
    sourceType: source.sourceType,
    rawText: source.rawText,
    extractedText: source.extractedText,
  });

  return NextResponse.json({ sourceId, extractedCount: createdCount });
}
