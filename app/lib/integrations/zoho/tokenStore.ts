import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

import type { ZohoTokenState } from "./oauth";

const TOKEN_STATE_VERSION = "zoho-token-state:v1";

export type ZohoOrganizationSummary = {
  organizationId: string;
  name: string;
  isDefault: boolean;
  currencyCode?: string;
  country?: string;
};

export type ZohoStoredConnection = {
  version: typeof TOKEN_STATE_VERSION;
  connectedAt: string;
  updatedAt: string;
  tokenState: {
    encrypted: string;
  };
  organizationId?: string;
  organizations?: ZohoOrganizationSummary[];
  scope?: string;
  expiresAt?: string;
  apiDomain?: string;
};

export async function readZohoConnection() {
  const state = await prisma.appState.findUnique({ where: { key: "zoho.connection" } });
  return (state?.value as ZohoStoredConnection | undefined) ?? null;
}

export async function writeZohoConnection(
  tokenState: ZohoTokenState,
  options?: {
    existing?: ZohoStoredConnection | null;
    organizationId?: string;
    organizations?: ZohoOrganizationSummary[];
  },
) {
  const now = new Date().toISOString();
  const payload: ZohoStoredConnection = {
    version: TOKEN_STATE_VERSION,
    connectedAt: options?.existing?.connectedAt ?? now,
    updatedAt: now,
    tokenState: {
      encrypted: encryptZohoTokenState(tokenState),
    },
    organizationId: options?.organizationId ?? options?.existing?.organizationId,
    organizations: options?.organizations ?? options?.existing?.organizations,
    scope: tokenState.scope,
    expiresAt: tokenState.expiresAt,
    apiDomain: tokenState.apiDomain,
  };

  await prisma.appState.upsert({
    where: { key: "zoho.connection" },
    create: { key: "zoho.connection", value: payload },
    update: { value: payload },
  });
  return payload;
}

export function decryptStoredZohoToken(connection: ZohoStoredConnection) {
  return decryptZohoTokenState(connection.tokenState.encrypted);
}

export function summarizeZohoConnection(connection: ZohoStoredConnection | null) {
  return {
    connected: Boolean(connection?.tokenState.encrypted),
    connectedAt: connection?.connectedAt ?? null,
    updatedAt: connection?.updatedAt ?? null,
    organizationId: connection?.organizationId ?? null,
    organizations: connection?.organizations ?? [],
    scope: connection?.scope ?? null,
    expiresAt: connection?.expiresAt ?? null,
    apiDomain: connection?.apiDomain ?? null,
  };
}

function encryptZohoTokenState(tokenState: ZohoTokenState) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
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

function decryptZohoTokenState(encrypted: string): ZohoTokenState {
  const [, ivEncoded, tagEncoded, ciphertextEncoded] = encrypted.split(".");
  if (!ivEncoded || !tagEncoded || !ciphertextEncoded) {
    throw new Error("Stored Zoho token state is malformed.");
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

  return JSON.parse(plaintext) as ZohoTokenState;
}

function encryptionKey() {
  const secret = process.env.ZOHO_TOKEN_ENCRYPTION_KEY || process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("ZOHO_TOKEN_ENCRYPTION_KEY or GMAIL_TOKEN_ENCRYPTION_KEY is required to store Zoho tokens.");
  }
  return createHash("sha256").update(secret).digest();
}


