import { GmailConnectionStatus, type GmailConnection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getGmailOAuthConfig } from "./config";
import { refreshAccessToken } from "./oauth";
import {
  markGmailMetadataError,
  readGmailConnectionMetadata,
  readTokenStateFromMetadata,
  toPrismaJsonObject,
  writeTokenStateMetadata,
} from "./tokenStore";

export type GmailAddress = {
  name?: string;
  email?: string;
};

export type GmailAttachmentMetadata = {
  gmailAttachmentId?: string;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  contentId?: string;
  storageRef?: string;
};

export type GmailMessageResource = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  sizeEstimate?: number;
  payload?: GmailPayloadPart;
};

export type GmailThreadResource = {
  id: string;
  historyId?: string;
  messages?: GmailMessageResource[];
};

export type GmailThreadListItem = {
  id: string;
  historyId?: string;
  snippet?: string;
};

type GmailThreadListResponse = {
  threads?: GmailThreadListItem[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

type GmailPayloadPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: {
    attachmentId?: string;
    size?: number;
    data?: string;
  };
  parts?: GmailPayloadPart[];
};

type GmailErrorResponse = {
  error?: {
    message?: string;
    status?: string;
  };
};

export async function getConnectedGmailConnection(companyId: string) {
  return prisma.gmailConnection.findFirst({
    where: {
      companyId,
      status: GmailConnectionStatus.CONNECTED,
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getReadOnlyGmailAccessToken(connection: GmailConnection, origin?: string) {
  const config = getGmailOAuthConfig(origin);
  if (!config.configured) {
    throw new Error(`Gmail OAuth is not configured. Missing: ${config.missing.join(", ")}.`);
  }

  const tokenState = readTokenStateFromMetadata(connection.metadata);
  const expiresAtMs = tokenState.expiresAt ? new Date(tokenState.expiresAt).getTime() : 0;
  if (tokenState.accessToken && expiresAtMs > Date.now() + 120_000) {
    return tokenState.accessToken;
  }

  if (!tokenState.refreshToken) {
    await markConnectionError(connection, "Gmail access token expired and no refresh token is stored.");
    throw new Error("Gmail access token expired and no refresh token is stored.");
  }

  try {
    const refreshed = await refreshAccessToken(config, tokenState.refreshToken);
    const nextTokenState = {
      ...tokenState,
      ...refreshed,
      refreshToken: tokenState.refreshToken,
    };
    const metadata = writeTokenStateMetadata(connection.metadata, nextTokenState);
    metadata.oauth = {
      ...metadata.oauth,
      lastTokenRefreshAt: new Date().toISOString(),
    };
    await prisma.gmailConnection.update({
      where: { id: connection.id },
      data: {
        status: GmailConnectionStatus.CONNECTED,
        metadata: toPrismaJsonObject(metadata),
      },
    });
    return refreshed.accessToken;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail token refresh failed.";
    await markConnectionError(connection, message);
    throw error;
  }
}

export async function fetchGmailThread(
  accessToken: string,
  threadId: string,
): Promise<GmailThreadResource> {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}`);
  url.searchParams.set("format", "full");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json()) as GmailThreadResource & GmailErrorResponse;
  if (!response.ok || !body.id) {
    throw new Error(body.error?.message ?? `Could not fetch Gmail thread ${threadId}.`);
  }
  return body;
}

export async function listGmailThreads(
  accessToken: string,
  options: {
    query: string;
    maxResults?: number;
    pageToken?: string;
  },
): Promise<GmailThreadListResponse> {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/threads");
  url.searchParams.set("q", options.query);
  url.searchParams.set("maxResults", String(Math.min(Math.max(options.maxResults ?? 50, 1), 100)));
  if (options.pageToken) url.searchParams.set("pageToken", options.pageToken);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json()) as GmailThreadListResponse & GmailErrorResponse;
  if (!response.ok) {
    throw new Error(body.error?.message ?? "Could not list Gmail threads.");
  }
  return body;
}

export async function fetchGmailMessage(
  accessToken: string,
  messageId: string,
): Promise<GmailMessageResource> {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`);
  url.searchParams.set("format", "full");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json()) as GmailMessageResource & GmailErrorResponse;
  if (!response.ok || !body.id) {
    throw new Error(body.error?.message ?? `Could not fetch Gmail message ${messageId}.`);
  }
  return body;
}

export async function fetchGmailAttachment(
  accessToken: string,
  input: { messageId: string; attachmentId: string },
) {
  const url = new URL(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${input.messageId}/attachments/${input.attachmentId}`,
  );

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json()) as { data?: string; size?: number } & GmailErrorResponse;
  if (!response.ok || !body.data) {
    throw new Error(body.error?.message ?? `Could not fetch Gmail attachment ${input.attachmentId}.`);
  }

  return {
    bytes: Buffer.from(body.data.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
    size: body.size,
  };
}

export function attachmentMetadataFromMessage(message: GmailMessageResource) {
  const attachments: GmailAttachmentMetadata[] = [];
  walkPayload(message.payload, (part) => {
    const filename = part.filename?.trim();
    const attachmentId = part.body?.attachmentId;
    if (!filename && !attachmentId) return;

    attachments.push({
      gmailAttachmentId: attachmentId,
      filename: filename || "inline-attachment",
      mimeType: part.mimeType,
      sizeBytes: part.body?.size,
      contentId: getHeader(part.headers, "Content-ID")?.replace(/^<|>$/g, ""),
      storageRef: attachmentId
        ? `gmail://messages/${message.id}/attachments/${attachmentId}`
        : undefined,
    });
  });
  return attachments;
}

export function getHeader(headers: Array<{ name: string; value: string }> | undefined, name: string) {
  return headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value;
}

export function decodeGmailBodyData(data?: string) {
  if (!data) return undefined;
  return Buffer.from(data.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8");
}

export function collectMessageBody(message: GmailMessageResource) {
  const body = { plain: undefined as string | undefined, html: undefined as string | undefined };
  walkPayload(message.payload, (part) => {
    if (part.mimeType === "text/plain" && part.body?.data && !body.plain) {
      body.plain = stripQuotedReplyText(decodeGmailBodyData(part.body.data));
    }
    if (part.mimeType === "text/html" && part.body?.data && !body.html) {
      body.html = decodeGmailBodyData(part.body.data);
    }
  });
  return body;
}

export function stripQuotedReplyText(input?: string) {
  if (!input) return input;
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      /^>/.test(trimmed) ||
      /^on .+ wrote:$/i.test(trimmed) ||
      /^from:\s.+/i.test(trimmed) ||
      /^sent:\s.+/i.test(trimmed) ||
      /^date:\s.+/i.test(trimmed) ||
      /^to:\s.+/i.test(trimmed) ||
      /^cc:\s.+/i.test(trimmed) ||
      /^subject:\s.+/i.test(trimmed) ||
      /^_{5,}$/.test(trimmed) ||
      /^-{5,}$/.test(trimmed)
    ) {
      break;
    }
    if (/^get outlook for /i.test(trimmed) || /^sent from my /i.test(trimmed)) {
      break;
    }
    kept.push(line);
  }

  const cleaned = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned || input.trim();
}

export async function markConnectionError(connection: GmailConnection, message: string) {
  await prisma.gmailConnection.update({
    where: { id: connection.id },
    data: {
      status: GmailConnectionStatus.ERROR,
      metadata: toPrismaJsonObject(markGmailMetadataError(connection.metadata, message)),
    },
  });
}

export function tokenStateAvailable(connection: GmailConnection) {
  return Boolean(readGmailConnectionMetadata(connection.metadata).oauth?.tokenState?.encrypted);
}

function walkPayload(part: GmailPayloadPart | undefined, visit: (part: GmailPayloadPart) => void) {
  if (!part) return;
  visit(part);
  for (const child of part.parts ?? []) walkPayload(child, visit);
}

function buildMimeMessage(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
  messageIdHeaders?: {
    inReplyTo?: string;
    references?: string;
  };
}) {
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
  ];

  if (input.messageIdHeaders?.inReplyTo) {
    headers.push(`In-Reply-To: ${input.messageIdHeaders.inReplyTo}`);
  }
  if (input.messageIdHeaders?.references) {
    headers.push(`References: ${input.messageIdHeaders.references}`);
  }

  const email = [...headers, "", input.body].join("\r\n");
  return Buffer.from(email)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendGmailMessage(
  accessToken: string,
  input: {
    from: string;
    to: string;
    subject: string;
    body: string;
    threadId: string;
    inReplyTo?: string;
    references?: string;
  },
) {
  const raw = buildMimeMessage({
    from: input.from,
    to: input.to,
    subject: input.subject,
    body: input.body,
    messageIdHeaders: {
      inReplyTo: input.inReplyTo,
      references: input.references,
    },
  });

  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw,
        threadId: input.threadId,
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send Gmail message: ${response.status} ${errorText}`);
  }

  return response.json();
}
