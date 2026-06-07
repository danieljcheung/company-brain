import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";

const TOKEN_STATE_VERSION = "gmail-token-state:v1";

export type GmailTokenState = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
  tokenType?: string;
};

export type GmailConnectionMetadata = {
  oauth?: {
    tokenState?: {
      version: typeof TOKEN_STATE_VERSION;
      encrypted: string;
    };
    scope?: string;
    connectedAt?: string;
    expiresAt?: string;
    lastTokenRefreshAt?: string;
    lastProfileCheckAt?: string;
  };
  lastError?: {
    message: string;
    at: string;
  };
  warnings?: string[];
  [key: string]: unknown;
};

export function encryptGmailTokenState(tokenState: GmailTokenState) {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(tokenState), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    Buffer.from("v1").toString("base64url"),
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptGmailTokenState(encrypted: string): GmailTokenState {
  const [, ivEncoded, tagEncoded, ciphertextEncoded] = encrypted.split(".");
  if (!ivEncoded || !tagEncoded || !ciphertextEncoded) {
    throw new Error("Stored Gmail token state is malformed.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivEncoded, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8");

  return JSON.parse(plaintext) as GmailTokenState;
}

export function readGmailConnectionMetadata(value: Prisma.JsonValue | null): GmailConnectionMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as GmailConnectionMetadata;
}

export function writeTokenStateMetadata(
  existing: Prisma.JsonValue | null,
  tokenState: GmailTokenState,
  options?: { warnings?: string[] },
): GmailConnectionMetadata {
  const metadata = readGmailConnectionMetadata(existing);
  const { lastError: _lastError, ...existingWithoutError } = metadata;
  void _lastError;
  const oauth: GmailConnectionMetadata["oauth"] = {
    ...metadata.oauth,
    tokenState: {
      version: TOKEN_STATE_VERSION,
      encrypted: encryptGmailTokenState(tokenState),
    },
    connectedAt: metadata.oauth?.connectedAt ?? new Date().toISOString(),
  };
  if (tokenState.scope) oauth.scope = tokenState.scope;
  if (tokenState.expiresAt) oauth.expiresAt = tokenState.expiresAt;

  return {
    ...existingWithoutError,
    oauth,
    ...(options?.warnings?.length || metadata.warnings
      ? { warnings: options?.warnings?.length ? options.warnings : metadata.warnings }
      : {}),
  };
}

export function readTokenStateFromMetadata(metadata: Prisma.JsonValue | null) {
  const parsed = readGmailConnectionMetadata(metadata);
  const encrypted = parsed.oauth?.tokenState?.encrypted;
  if (!encrypted) throw new Error("No encrypted Gmail token state is stored.");
  return decryptGmailTokenState(encrypted);
}

export function markGmailMetadataError(
  existing: Prisma.JsonValue | null,
  message: string,
): GmailConnectionMetadata {
  return {
    ...readGmailConnectionMetadata(existing),
    lastError: {
      message,
      at: new Date().toISOString(),
    },
  };
}

export function summarizeGmailConnectionMetadata(value: Prisma.JsonValue | null) {
  const metadata = readGmailConnectionMetadata(value);
  return {
    scope: metadata.oauth?.scope ?? null,
    connectedAt: metadata.oauth?.connectedAt ?? null,
    expiresAt: metadata.oauth?.expiresAt ?? null,
    lastTokenRefreshAt: metadata.oauth?.lastTokenRefreshAt ?? null,
    lastError: metadata.lastError ?? null,
    warnings: metadata.warnings ?? [],
    hasTokenState: Boolean(metadata.oauth?.tokenState?.encrypted),
  };
}

export function toPrismaJsonObject(metadata: GmailConnectionMetadata): Prisma.InputJsonObject {
  return metadata as Prisma.InputJsonObject;
}

function encryptionKey() {
  const secret = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY is required to store Gmail tokens.");
  }
  return createHash("sha256").update(secret).digest();
}
