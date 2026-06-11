import { createHash } from "crypto";
import { BrainCandidateKind, BrainSection, BrainSourceType } from "@prisma/client";

export type ExtractedCandidateInput = {
  kind: BrainCandidateKind;
  section: BrainSection;
  title: string;
  body: string;
  confidence: number;
  extractedBy: string;
  locator: string;
  evidence: string;
  structuredData?: Record<string, unknown>;
};

function normalizeLine(line: string) {
  return line.trim().replace(/\s+/g, " ");
}

function splitSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function extractFromText(rawText: string): ExtractedCandidateInput[] {
  const lines = rawText.split(/\r?\n/);
  const candidates: ExtractedCandidateInput[] = [];

  for (const [index, rawLine] of lines.entries()) {
    const line = normalizeLine(rawLine);
    if (!line) continue;

    const companyMatch = line.match(/^company:\s*(.+)$/i);
    if (companyMatch) {
      candidates.push({
        kind: BrainCandidateKind.ENTITY,
        section: BrainSection.COMPANY_PROFILE,
        title: `Company name is ${companyMatch[1]}`,
        body: `The source states the company name as ${companyMatch[1]}.`,
        confidence: 0.95,
        extractedBy: "deterministic-parser:v1/company-line",
        locator: `line ${index + 1}`,
        evidence: rawLine.trim(),
      });
      continue;
    }

    const ownerMatch = line.match(/^(.+?)\s+is\s+owner\/operator\.?$/i);
    if (ownerMatch) {
      const person = ownerMatch[1].trim();
      candidates.push({
        kind: BrainCandidateKind.ENTITY,
        section: BrainSection.PEOPLE_ROLES,
        title: `${person} is owner/operator`,
        body: `${person} appears to be the owner/operator.`,
        confidence: 0.9,
        extractedBy: "deterministic-parser:v1/role-line",
        locator: `line ${index + 1}`,
        evidence: rawLine.trim(),
      });
    }
  }

  for (const [sentenceIndex, sentence] of splitSentences(rawText).entries()) {
    const normalized = normalizeLine(sentence);
    const approvalMatch = normalized.match(/over\s+\$?(\d+(?:\.\d+)?)\s+require(?:s)?\s+owner\s+approval/i);
    if (approvalMatch) {
      candidates.push({
        kind: BrainCandidateKind.RULE,
        section: BrainSection.APPROVAL_RULES,
        title: `Quotes over $${approvalMatch[1]} require owner approval`,
        body: `Any quote over $${approvalMatch[1]} should be owner-approved before agent action.`,
        confidence: 0.92,
        extractedBy: "deterministic-parser:v1/approval-threshold",
        locator: `sentence ${sentenceIndex + 1}`,
        evidence: sentence,
      });
    }

    const receiptMatch = normalized.match(/receipts?\s+must\s+show\s+(.+)$/i);
    if (receiptMatch) {
      candidates.push({
        kind: BrainCandidateKind.RULE,
        section: BrainSection.RECEIPT_RULES,
        title: "Receipt required fields",
        body: `Receipts must show ${receiptMatch[1]}.`,
        confidence: 0.94,
        extractedBy: "deterministic-parser:v1/receipt-requirements",
        locator: `sentence ${sentenceIndex + 1}`,
        evidence: sentence,
      });
    }
  }

  return candidates;
}

function extractFromCsv(rawText: string): ExtractedCandidateInput[] {
  const rows = rawText.split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) return [];
  const headers = rows[0].split(",").map((h) => h.trim().toLowerCase());
  const itemIdx = headers.indexOf("item");
  const categoryIdx = headers.indexOf("category");
  const priceIdx = headers.indexOf("price");
  if (itemIdx === -1 || categoryIdx === -1 || priceIdx === -1) return [];

  const candidates: ExtractedCandidateInput[] = [];
  for (const [rowIndex, row] of rows.slice(1).entries()) {
    const cols = row.split(",").map((col) => col.trim());
    const item = cols[itemIdx];
    const category = cols[categoryIdx];
    const price = cols[priceIdx];
    if (!item || !price) continue;

    candidates.push({
      kind: BrainCandidateKind.FACT,
      section: category.toLowerCase() === "fee" ? BrainSection.PRICING_RULES : BrainSection.PRODUCTS_MENU,
      title: `${item} menu price`,
      body: `${item} is listed in category ${category || "unknown"} at $${price}.`,
      confidence: 0.98,
      extractedBy: "deterministic-parser:v1/csv-item-price",
      locator: `row ${rowIndex + 2}`,
      evidence: row,
      structuredData: { item, category, price },
    });
  }

  return candidates;
}

export function hashSourceText(text: string) {
  return `sha256:${createHash("sha256").update(text).digest("hex").slice(0, 16)}`;
}

export function hashSourceBytes(bytes: Buffer) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`;
}

function coerceKind(value: string): BrainCandidateKind | null {
  const normalized = value.trim().toUpperCase();
  if (normalized in BrainCandidateKind) {
    return BrainCandidateKind[normalized as keyof typeof BrainCandidateKind];
  }
  return null;
}

function coerceSection(value: string): BrainSection | null {
  const normalized = value.trim().toUpperCase();
  if (normalized in BrainSection) {
    return BrainSection[normalized as keyof typeof BrainSection];
  }
  return null;
}

function coerceConfidence(value: unknown, fallback = 0.72) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function parseOpenAiCandidatePayload(payload: unknown): ExtractedCandidateInput[] {
  if (!payload || typeof payload !== "object" || !("candidates" in payload)) return [];
  const raw = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(raw)) return [];

  const out: ExtractedCandidateInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    const kind = coerceKind(String(candidate.kind ?? ""));
    const section = coerceSection(String(candidate.section ?? ""));
    const title = String(candidate.title ?? "").trim();
    const body = String(candidate.body ?? "").trim();
    const evidence = String(candidate.evidence ?? "").trim();
    const locator = String(candidate.locator ?? "source").trim() || "source";
    if (!kind || !section || !title || !body || !evidence) continue;

    out.push({
      kind,
      section,
      title,
      body,
      confidence: coerceConfidence(candidate.confidence, 0.72),
      extractedBy: "openai:chat-completions-json:v1",
      locator,
      evidence,
      structuredData:
        candidate.structuredData && typeof candidate.structuredData === "object"
          ? (candidate.structuredData as Record<string, unknown>)
          : undefined,
    });
  }

  return out;
}

async function extractWithOpenAi(input: {
  sourceType: BrainSourceType;
  title: string;
  textForExtraction: string;
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || !input.textForExtraction.trim()) return [];

  const promptText = input.textForExtraction.slice(0, 18000);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_EXTRACTION_MODEL || "gpt-5.4-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You extract candidate Company Brain records from messy business artifacts. Return JSON only in this shape: {\"candidates\":[{\"kind\":\"ENTITY|FACT|RULE|OPEN_QUESTION|RELATIONSHIP\",\"section\":\"COMPANY_PROFILE|PEOPLE_ROLES|CUSTOMERS|VENDORS|PRODUCTS_MENU|PRICING_RULES|EXPENSE_CATEGORIES|RECEIPT_RULES|REIMBURSEMENT_RULES|SHEET_MAPPINGS|WORKFLOWS|APPROVAL_RULES|OPEN_QUESTIONS|SOURCE_LIBRARY\",\"title\":\"...\",\"body\":\"...\",\"confidence\":0.0,\"locator\":\"...\",\"evidence\":\"...\",\"structuredData\":{}}]}. Prefer multiple concise candidates. For email/inquiry text, include tone and inquiry-to-invoice workflow candidates when evidence exists.",
        },
        {
          role: "user",
          content: [
            `Source title: ${input.title}`,
            `Source type: ${input.sourceType}`,
            "Extract only evidence-backed candidate records:",
            promptText,
          ].join("\n\n"),
        },
      ],
    }),
  });

  if (!response.ok) return [];

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const rawContent = body.choices?.[0]?.message?.content;
  if (!rawContent) return [];

  try {
    const parsed = JSON.parse(rawContent);
    return parseOpenAiCandidatePayload(parsed);
  } catch {
    return [];
  }
}

export function extractCandidatesDeterministic(input: {
  sourceType: BrainSourceType;
  rawText: string;
}): ExtractedCandidateInput[] {
  if (!input.rawText.trim()) return [];
  if (input.sourceType === BrainSourceType.CSV) {
    return extractFromCsv(input.rawText);
  }
  return extractFromText(input.rawText);
}

function dedupeCandidates(candidates: ExtractedCandidateInput[]) {
  const seen = new Set<string>();
  const deduped: ExtractedCandidateInput[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.kind}|${candidate.section}|${candidate.title}|${candidate.body}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

export async function extractCandidatesForSource(input: {
  sourceType: BrainSourceType;
  title: string;
  rawText: string;
  extractedText?: string | null;
}): Promise<ExtractedCandidateInput[]> {
  const textForExtraction = input.extractedText?.trim() || input.rawText;
  const aiCandidates = await extractWithOpenAi({
    sourceType: input.sourceType,
    title: input.title,
    textForExtraction,
  });
  const deterministic = extractCandidatesDeterministic({
    sourceType: input.sourceType,
    rawText: textForExtraction,
  });

  return dedupeCandidates(aiCandidates.length > 0 ? [...aiCandidates, ...deterministic] : deterministic);
}
