import { getRateLimit } from "@/app/lib/rateLimit";
import { BrainSourceType } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { generateCandidatesForSource } from "@/app/lib/brainCandidatePipeline";
import { hashSourceBytes, hashSourceText } from "@/app/lib/brainExtraction";
import { buildSourceObjectKey, hasR2Config, uploadArtifactToR2 } from "@/app/lib/r2";
import { prisma } from "@/lib/prisma";
import {
  databaseUnavailableResponse,
  getDefaultContext,
  hasDatabaseUrl,
  mapSourceTypeLabel,
  requireApiAuth,
} from "../_shared";

const VALID_SOURCE_TYPES = new Set(Object.values(BrainSourceType));
const TEXT_SOURCE_TYPES = new Set<BrainSourceType>([
  BrainSourceType.TEXT,
  BrainSourceType.MARKDOWN,
  BrainSourceType.CSV,
  BrainSourceType.EMAIL_EXPORT,
]);
const SUPPORTED_FILE_SOURCE_TYPES = new Set<BrainSourceType>([
  BrainSourceType.TEXT,
  BrainSourceType.MARKDOWN,
  BrainSourceType.CSV,
  BrainSourceType.EMAIL_EXPORT,
  BrainSourceType.PDF,
  BrainSourceType.IMAGE,
]);
const DEFAULT_MAX_SOURCE_UPLOAD_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_SOURCE_TEXT_CHARS = 1_000_000;

const FILE_EXTENSION_TYPE: Record<string, BrainSourceType> = {
  txt: BrainSourceType.TEXT,
  md: BrainSourceType.MARKDOWN,
  markdown: BrainSourceType.MARKDOWN,
  csv: BrainSourceType.CSV,
  eml: BrainSourceType.EMAIL_EXPORT,
  pdf: BrainSourceType.PDF,
  png: BrainSourceType.IMAGE,
  jpg: BrainSourceType.IMAGE,
  jpeg: BrainSourceType.IMAGE,
  webp: BrainSourceType.IMAGE,
  heic: BrainSourceType.IMAGE,
};

const MIME_TYPE_SOURCE: Record<string, BrainSourceType> = {
  "text/plain": BrainSourceType.TEXT,
  "text/markdown": BrainSourceType.MARKDOWN,
  "text/csv": BrainSourceType.CSV,
  "message/rfc822": BrainSourceType.EMAIL_EXPORT,
  "application/pdf": BrainSourceType.PDF,
  "image/png": BrainSourceType.IMAGE,
  "image/jpeg": BrainSourceType.IMAGE,
  "image/webp": BrainSourceType.IMAGE,
  "image/heic": BrainSourceType.IMAGE,
};

function positiveIntegerEnv(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function maxSourceUploadBytes() {
  return positiveIntegerEnv("COMPANY_BRAIN_MAX_SOURCE_UPLOAD_BYTES", DEFAULT_MAX_SOURCE_UPLOAD_BYTES);
}

function maxSourceTextChars() {
  return positiveIntegerEnv("COMPANY_BRAIN_MAX_SOURCE_TEXT_CHARS", DEFAULT_MAX_SOURCE_TEXT_CHARS);
}

function normalizeSourceType(value?: string | null) {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return null;
  if (!(normalized in BrainSourceType)) return null;
  return BrainSourceType[normalized as keyof typeof BrainSourceType];
}

function inferSourceTypeFromFile(filename: string, mimeType?: string) {
  const fromMime = mimeType ? MIME_TYPE_SOURCE[mimeType.toLowerCase()] : undefined;
  if (fromMime) return fromMime;
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return FILE_EXTENSION_TYPE[ext] ?? BrainSourceType.OTHER;
}

function fileHasSupportedType(filename: string, mimeType?: string) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return Boolean((mimeType && MIME_TYPE_SOURCE[mimeType.toLowerCase()]) || FILE_EXTENSION_TYPE[ext]);
}

function decodeLikelyTextFile(input: {
  bytes: Buffer;
  sourceType: BrainSourceType;
  mimeType?: string;
  filename: string;
}) {
  const ext = input.filename.split(".").pop()?.toLowerCase();
  const looksText =
    TEXT_SOURCE_TYPES.has(input.sourceType) ||
    input.mimeType?.startsWith("text/") ||
    Boolean(ext && ["txt", "md", "markdown", "csv", "eml", "json"].includes(ext));

  if (!looksText) return "";

  const decoded = input.bytes.toString("utf-8");
  if (decoded.includes("\u0000")) {
    return "";
  }

  return decoded;
}

async function extractTextForImageWithOpenAi(input: {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}) {
  if (!input.mimeType.startsWith("image/")) return null;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const contentDataUrl = `data:${input.mimeType};base64,${input.bytes.toString("base64")}`;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_EXTRACTION_MODEL || "gpt-5.4-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Extract readable business-relevant text from the image. Return plain text only with no commentary.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract text from this artifact: ${input.fileName}`,
            },
            {
              type: "image_url",
              image_url: { url: contentDataUrl, detail: "high" },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) return null;
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  return body.choices?.[0]?.message?.content?.trim() || null;
}

async function extractTextForPdf(input: {
  mimeType?: string;
  filename: string;
  bytes: Buffer;
}) {
  const isPdf =
    input.mimeType === "application/pdf" ||
    input.filename.toLowerCase().endsWith(".pdf");
  if (!isPdf) return null;

  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: input.bytes });
  try {
    const result = await parser.getText();
    return result.text.trim() || null;
  } catch (error) {
    throw new Error(
      `PDF text extraction failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  } finally {
    await parser.destroy();
  }
}

type CreateSourceInput = {
  title: string;
  sourceType: BrainSourceType;
  rawText: string;
  extractedText?: string | null;
  contentHash: string;
  storageRef?: string | null;
  metadata: Prisma.InputJsonValue;
  autoExtract: boolean;
};

async function persistSource(input: {
  companyId: string;
  payload: CreateSourceInput;
}) {
  return prisma.brainSource.upsert({
    where: {
      companyId_contentHash: {
        companyId: input.companyId,
        contentHash: input.payload.contentHash,
      },
    },
    update: {
      title: input.payload.title,
      sourceType: input.payload.sourceType,
      rawText: input.payload.rawText,
      extractedText: input.payload.extractedText,
      metadata: input.payload.metadata,
      storageRef: input.payload.storageRef,
    },
    create: {
      companyId: input.companyId,
      title: input.payload.title,
      sourceType: input.payload.sourceType,
      contentHash: input.payload.contentHash,
      rawText: input.payload.rawText,
      extractedText: input.payload.extractedText,
      metadata: input.payload.metadata,
      storageRef: input.payload.storageRef,
    },
  });
}

export async function GET(request: NextRequest) {
  const authResponse = await requireApiAuth(request);
  if (authResponse) return authResponse;
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();
  const { company } = await getDefaultContext();
  const summaryOnly = request.nextUrl.searchParams.get("summary") === "1";
  const sources = await prisma.brainSource.findMany({
    where: { companyId: company.id },
    orderBy: { importedAt: "desc" },
    include: {
      candidates: { select: { candidateId: true } },
      records: { select: { recordId: true } },
    },
  });

  return NextResponse.json({
    sources: sources.map((source) => ({
      id: source.id,
      title: source.title,
      sourceType: source.sourceType,
      sourceTypeLabel: mapSourceTypeLabel(source.sourceType),
      importedAt: source.importedAt,
      contentHash: source.contentHash,
      storageRef: source.storageRef,
      metadata: source.metadata,
      rawText: summaryOnly ? "" : source.rawText,
      extractedText: summaryOnly ? null : source.extractedText,
      candidateCount: source.candidates.length,
      approvedRecordCount: source.records.length,
    })),
  });
}

async function createFromJsonBody(request: NextRequest): Promise<CreateSourceInput> {
  const body = (await request.json()) as {
    title?: string;
    sourceType?: BrainSourceType;
    rawText?: string;
    metadata?: Record<string, unknown>;
    autoExtract?: boolean;
  };

  const title = body.title?.trim();
  const rawText = body.rawText?.trim() || "";
  const sourceType = body.sourceType;
  if (!title || !rawText || !sourceType || !VALID_SOURCE_TYPES.has(sourceType)) {
    throw new Error("title, sourceType, and rawText are required.");
  }
  if (rawText.length > maxSourceTextChars()) {
    throw new Error(`Source text is too large. Limit is ${maxSourceTextChars()} characters.`);
  }

  return {
    title,
    sourceType,
    rawText,
    extractedText: rawText,
    contentHash: hashSourceText(rawText),
    storageRef: null,
    metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
    autoExtract: body.autoExtract !== false,
  };
}

async function createFromFormData(request: NextRequest): Promise<CreateSourceInput> {
  const formData = await request.formData();
  const titleValue = String(formData.get("title") ?? "").trim();
  const sourceTypeValue = normalizeSourceType(String(formData.get("sourceType") ?? ""));
  const pastedText = String(formData.get("text") ?? "").trim();
  const autoExtractRaw = String(formData.get("autoExtract") ?? "true").toLowerCase();
  const autoExtract = autoExtractRaw !== "false";
  const filePart = formData.get("file");
  const file = filePart instanceof File ? filePart : null;

  if (!file && !pastedText) {
    throw new Error("Provide a file upload or pasted text.");
  }

  if (pastedText.length > maxSourceTextChars()) {
    throw new Error(`Source text is too large. Limit is ${maxSourceTextChars()} characters.`);
  }

  if (!file) {
    const sourceType = sourceTypeValue ?? BrainSourceType.TEXT;
    const title = titleValue || "pasted-source.txt";
    return {
      title,
      sourceType,
      rawText: pastedText,
      extractedText: pastedText,
      contentHash: hashSourceText(pastedText),
      storageRef: null,
      metadata: {
        ingestMethod: "paste_text",
      } as Prisma.InputJsonValue,
      autoExtract,
    };
  }


  if (file.size <= 0) {
    throw new Error("Uploaded file is empty.");
  }
  if (file.size > maxSourceUploadBytes()) {
    throw new Error(`Uploaded file is too large. Limit is ${maxSourceUploadBytes()} bytes.`);
  }
  if (!fileHasSupportedType(file.name, file.type)) {
    throw new Error("Unsupported source file type.");
  }

  if (!hasR2Config()) {
    throw new Error(
      "R2 upload is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.",
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > maxSourceUploadBytes()) {
    throw new Error(`Uploaded file is too large. Limit is ${maxSourceUploadBytes()} bytes.`);
  }
  const inferredType = inferSourceTypeFromFile(file.name, file.type);
  const sourceType = sourceTypeValue ?? inferredType;
  if (!SUPPORTED_FILE_SOURCE_TYPES.has(sourceType)) {
    throw new Error("Unsupported source file type.");
  }
  const fileHash = hashSourceBytes(bytes).replace("sha256:", "");
  const objectKey = buildSourceObjectKey({ hash: fileHash, filename: file.name });
  const uploadResult = await uploadArtifactToR2({
    objectKey,
    body: bytes,
    contentType: file.type || "application/octet-stream",
  });

  const rawText = decodeLikelyTextFile({
    bytes,
    sourceType,
    mimeType: file.type,
    filename: file.name,
  });
  const pdfText = rawText
    ? null
    : await extractTextForPdf({
        filename: file.name,
        mimeType: file.type,
        bytes,
      });
  const imageText =
    rawText || pdfText
      ? null
      : await extractTextForImageWithOpenAi({
          fileName: file.name,
          mimeType: file.type,
          bytes,
        });
  const extractedText = pdfText || imageText || rawText || null;
  const fallbackTitle = file.name || "uploaded-artifact";
  const title = titleValue || fallbackTitle;

  return {
    title,
    sourceType,
    rawText: rawText || "",
    extractedText,
    contentHash: hashSourceBytes(bytes),
    storageRef: uploadResult.storageRef,
    metadata: {
      ingestMethod: "upload_file",
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      r2ObjectKey: uploadResult.storageRef,
      pdfTextExtractionUsed: Boolean(pdfText),
      openAiTextExtractionUsed: Boolean(imageText),
    } as Prisma.InputJsonValue,
    autoExtract,
  };
}

export async function POST(request: NextRequest) {
  const authResponse = await requireApiAuth(request);
  if (authResponse) return authResponse;
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || 
             request.headers.get("x-real-ip")?.trim() || 
             "127.0.0.1";
  const rate = getRateLimit(ip, "sources_upload", 5, 60 * 1000); // 5 uploads per minute
  if (rate.isBlocked) {
    return NextResponse.json(
      { error: `Too many source uploads. Please try again in ${rate.resetInSeconds} seconds.` },
      { status: 429 },
    );
  }
  rate.increment();

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number.parseInt(contentLength, 10) > maxSourceUploadBytes() + 64 * 1024) {
    return NextResponse.json(
      { error: `Request body is too large. Limit is ${maxSourceUploadBytes()} bytes.` },
      { status: 413 },
    );
  }

  const contentType = request.headers.get("content-type") || "";

  try {
    const payload = contentType.includes("multipart/form-data")
      ? await createFromFormData(request)
      : await createFromJsonBody(request);

    const { company } = await getDefaultContext();
    const source = await persistSource({
      companyId: company.id,
      payload,
    });

    let extractedCount = 0;
    if (payload.autoExtract) {
      extractedCount = await generateCandidatesForSource({
        companyId: company.id,
        sourceId: source.id,
        sourceTitle: source.title,
        sourceType: source.sourceType,
        rawText: source.rawText,
        extractedText: source.extractedText,
      });
    }

    return NextResponse.json({
      sourceId: source.id,
      extractedCount,
      autoExtracted: payload.autoExtract,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create source." },
      { status: 400 },
    );
  }
}
