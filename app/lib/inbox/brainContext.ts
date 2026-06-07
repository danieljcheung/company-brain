import { BrainReviewStatus, BrainSection, type Prisma } from "@prisma/client";

export type InboxBrainContextRecord = {
  id: string;
  section: BrainSection;
  sectionLabel: string;
  title: string;
  bodyExcerpt: string;
  structuredDataExcerpt: string | null;
  provenanceSummary: string | null;
};

const SECTION_PRIORITY: Partial<Record<BrainSection, number>> = {
  [BrainSection.PRODUCTS_MENU]: 0,
  [BrainSection.PRICING_RULES]: 1,
  [BrainSection.WORKFLOWS]: 2,
  [BrainSection.APPROVAL_RULES]: 3,
  [BrainSection.COMPANY_PROFILE]: 4,
};

const DEFAULT_LIMIT = 40;
const DEFAULT_CHARACTER_BUDGET = 25000;
const BODY_EXCERPT_LIMIT = 700;
const DATA_EXCERPT_LIMIT = 500;

export async function loadApprovedBrainContextForDraft(
  db: Prisma.TransactionClient,
  input: { companyId: string; limit?: number; characterBudget?: number },
): Promise<InboxBrainContextRecord[]> {
  const records = await db.brainRecord.findMany({
    where: {
      companyId: input.companyId,
      status: BrainReviewStatus.APPROVED,
    },
    select: {
      id: true,
      section: true,
      title: true,
      body: true,
      structuredData: true,
      approvedAt: true,
      currentVersion: true,
      sources: {
        select: { locator: true, evidence: true, source: { select: { title: true } } },
        take: 2,
      },
    },
  });

  const sortedRecords = records.sort((left, right) => {
    const leftRank = sectionRank(left.section);
    const rightRank = sectionRank(right.section);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    const leftTime = left.approvedAt ? new Date(left.approvedAt).getTime() : 0;
    const rightTime = right.approvedAt ? new Date(right.approvedAt).getTime() : 0;
    return rightTime - leftTime;
  });

  let remaining = input.characterBudget ?? DEFAULT_CHARACTER_BUDGET;
  const compactRecords: InboxBrainContextRecord[] = [];
  for (const record of sortedRecords) {
    if (compactRecords.length >= (input.limit ?? DEFAULT_LIMIT) || remaining <= 0) break;

    const bodyExcerpt = truncate(cleanText(record.body), Math.min(BODY_EXCERPT_LIMIT, remaining));
    remaining -= bodyExcerpt.length;
    const structuredDataExcerpt = compactJson(record.structuredData, Math.min(DATA_EXCERPT_LIMIT, remaining));
    if (structuredDataExcerpt) remaining -= structuredDataExcerpt.length;

    compactRecords.push({
      id: record.id,
      section: record.section,
      sectionLabel: labelizeSection(record.section),
      title: record.title,
      bodyExcerpt,
      structuredDataExcerpt,
      provenanceSummary: summarizeProvenance(record.sources, record.currentVersion),
    });
  }

  return compactRecords;
}

function sectionRank(section: BrainSection) {
  return SECTION_PRIORITY[section] ?? 100;
}

function summarizeProvenance(
  sources: Array<{ locator: string | null; evidence: string; source: { title: string } }>,
  version: number,
) {
  const sourceText = sources
    .map((source) => [source.source.title, source.locator, source.evidence].filter(Boolean).join(" - "))
    .filter(Boolean)
    .join("; ");
  return sourceText ? `v${version}: ${truncate(cleanText(sourceText), 300)}` : `v${version}`;
}

function compactJson(value: Prisma.JsonValue, limit: number) {
  if (limit <= 0 || !value || (typeof value === "object" && Object.keys(value).length === 0)) return null;
  return truncate(cleanText(JSON.stringify(value)), limit);
}

function labelizeSection(section: BrainSection) {
  return section
    .toLowerCase()
    .split("_")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function cleanText(value: string) {
  return value.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
}

function truncate(value: string, limit: number) {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}
