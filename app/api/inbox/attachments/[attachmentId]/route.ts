import { NextRequest, NextResponse } from "next/server";

import {
  fetchGmailAttachment,
  getConnectedGmailConnection,
  getReadOnlyGmailAccessToken,
} from "@/app/lib/integrations/gmail/client";
import {
  attachmentLifecycleStatus,
  attachmentMetadataObject,
} from "@/app/lib/inbox/attachmentLifecycle";
import {
  buildLocalAttachmentStorageRef,
  hashAttachmentBytes,
  isLocalAttachmentStorageRef,
  readLocalAttachment,
  writeLocalAttachment,
} from "@/app/lib/inbox/attachmentFiles";
import { prisma } from "@/lib/prisma";
import {
  databaseUnavailableResponse,
  getDefaultContext,
  hasDatabaseUrl,
  requireApiAuth,
} from "../../../brain/_shared";

type AttachmentRouteContext = {
  params: Promise<{ attachmentId: string }>;
};
const DEFAULT_MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

function maxAttachmentBytes() {
  const parsed = Number.parseInt(process.env.COMPANY_BRAIN_MAX_INBOX_ATTACHMENT_BYTES ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_ATTACHMENT_BYTES;
}

export async function GET(request: NextRequest, context: AttachmentRouteContext) {
  const authResponse = await requireApiAuth(request);
  if (authResponse) return authResponse;
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();
  const { attachmentId } = await context.params;
  const { company } = await getDefaultContext();
  const attachment = await prisma.gmailAttachment.findFirst({
    where: {
      id: attachmentId,
      message: { thread: { companyId: company.id } },
    },
  });

  if (!attachment) {
    return NextResponse.json({ error: "Attachment was not found." }, { status: 404 });
  }

  if (!isLocalAttachmentStorageRef(attachment.storageRef)) {
    return NextResponse.json(
      { error: "Attachment has not been downloaded locally yet." },
      { status: 409 },
    );
  }

  const localStorageRef = attachment.storageRef;
  if (!localStorageRef) {
    return NextResponse.json(
      { error: "Attachment has not been downloaded locally yet." },
      { status: 409 },
    );
  }

  const bytes = await readLocalAttachment(localStorageRef);
  if (bytes.length > maxAttachmentBytes()) {
    return NextResponse.json(
      { error: `Attachment is too large. Limit is ${maxAttachmentBytes()} bytes.` },
      { status: 413 },
    );
  }
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": attachment.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${contentDispositionFilename(attachment.filename)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: NextRequest, context: AttachmentRouteContext) {
  const authResponse = await requireApiAuth(request);
  if (authResponse) return authResponse;
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();
  const { attachmentId } = await context.params;
  let body: { intent?: string };
  try {
    body = await readBody(request);
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }
  const { company } = await getDefaultContext();
  const attachment = await prisma.gmailAttachment.findFirst({
    where: {
      id: attachmentId,
      message: { thread: { companyId: company.id } },
    },
    include: {
      message: {
        include: {
          thread: { include: { inboxEvent: true } },
        },
      },
    },
  });

  if (!attachment) {
    return NextResponse.json({ error: "Attachment was not found." }, { status: 404 });
  }

  try {
    if (body.intent === "download" || body.intent === "view") {
      const workingAttachment = await ensureDownloaded(attachment, company.id);
      return NextResponse.json({ attachment: serializeAttachment(workingAttachment) });
    }

    return NextResponse.json({ error: "Unsupported attachment intent." }, { status: 400 });
  } catch (error) {
    const metadata = {
      ...attachmentMetadataObject(attachment.metadata),
      lifecycleStatus: "failed",
      error: error instanceof Error ? error.message : "Attachment action failed.",
      failedAt: new Date().toISOString(),
    };
    await prisma.gmailAttachment.update({
      where: { id: attachment.id },
      data: { metadata },
    });
    return NextResponse.json(
      { error: metadata.error },
      { status: 400 },
    );
  }
}

async function ensureDownloaded(
  attachment: {
    id: string;
    filename: string;
    mimeType: string | null;
    sizeBytes: number | null;
    contentId: string | null;
    storageRef: string | null;
    metadata: unknown;
  },
  companyId: string,
) {
  if (isLocalAttachmentStorageRef(attachment.storageRef)) return attachment;
  const knownSize = attachment.sizeBytes;
  if (typeof knownSize === "number" && knownSize > maxAttachmentBytes()) {
    throw new Error(`Attachment is too large. Limit is ${maxAttachmentBytes()} bytes.`);
  }

  const gmailRef = attachment.storageRef;
  const parsed = parseGmailAttachmentRef(gmailRef);
  if (!parsed) throw new Error("Attachment does not have a Gmail download reference.");

  const connection = await getConnectedGmailConnection(companyId);
  if (!connection) throw new Error("Connected Gmail account was not found.");
  const accessToken = await getReadOnlyGmailAccessToken(connection);
  const result = await fetchGmailAttachment(accessToken, parsed);
  const downloadedSize = result.size ?? result.bytes.length;
  if (downloadedSize > maxAttachmentBytes() || result.bytes.length > maxAttachmentBytes()) {
    throw new Error(`Attachment is too large. Limit is ${maxAttachmentBytes()} bytes.`);
  }
  const hash = hashAttachmentBytes(result.bytes);
  const localStorageRef = buildLocalAttachmentStorageRef({
    hash,
    filename: attachment.filename,
  });
  await writeLocalAttachment({ storageRef: localStorageRef, bytes: result.bytes });

  const metadata = {
    ...attachmentMetadataObject(attachment.metadata),
    lifecycleStatus: "downloaded",
    contentHash: hash,
    downloadedAt: new Date().toISOString(),
    gmailStorageRef: gmailRef,
    downloadedSizeBytes: downloadedSize,
  };

  return prisma.gmailAttachment.update({
    where: { id: attachment.id },
    data: {
      storageRef: localStorageRef,
      metadata,
    },
  });
}

function parseGmailAttachmentRef(value: string | null) {
  const match = value?.match(/^gmail:\/\/messages\/([^/]+)\/attachments\/(.+)$/);
  if (!match) return null;
  return { messageId: match[1], attachmentId: match[2] };
}

function contentDispositionFilename(filename: string) {
  return filename.replace(/[\r\n"]/g, "").slice(0, 180) || "attachment";
}

function serializeAttachment(attachment: {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  contentId: string | null;
  storageRef: string | null;
  metadata: unknown;
}) {
  const metadata = attachmentMetadataObject(attachment.metadata);
  return {
    id: attachment.id,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    contentId: attachment.contentId,
    storageRef: attachment.storageRef,
    lifecycleStatus: attachmentLifecycleStatus(attachment.metadata),
    contentHash: stringValue(metadata.contentHash),
  };
}

async function readBody(request: NextRequest): Promise<{ intent?: string }> {
  const text = await request.text();
  if (!text.trim()) return {};
  return JSON.parse(text) as { intent?: string };
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
