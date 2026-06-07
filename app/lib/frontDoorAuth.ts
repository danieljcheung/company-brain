export const FRONT_DOOR_SESSION_COOKIE = "company_brain_session";
export const FRONT_DOOR_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

type SessionPayload = {
  iat: number;
  exp: number;
};

const textEncoder = new TextEncoder();

export function frontDoorMissingConfig() {
  const missing: string[] = [];
  if (!process.env.COMPANY_BRAIN_APP_PASSWORD?.trim()) missing.push("COMPANY_BRAIN_APP_PASSWORD");
  if (!process.env.COMPANY_BRAIN_SESSION_SECRET?.trim()) missing.push("COMPANY_BRAIN_SESSION_SECRET");
  return missing;
}

export async function verifyFrontDoorPassword(password: string) {
  const expected = process.env.COMPANY_BRAIN_APP_PASSWORD?.trim();
  if (!expected) return false;
  return constantTimeEqual(password, expected);
}

export async function createFrontDoorSession(now = Date.now()) {
  const secret = sessionSecret();
  if (!secret) throw new Error("COMPANY_BRAIN_SESSION_SECRET is not configured.");

  const payload: SessionPayload = {
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + FRONT_DOOR_SESSION_TTL_SECONDS,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = await sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export async function verifyFrontDoorSession(value: string | undefined | null, now = Date.now()) {
  const secret = sessionSecret();
  if (!value || !secret) return false;

  const [encodedPayload, signature, extra] = value.split(".");
  if (!encodedPayload || !signature || extra !== undefined) return false;

  const expectedSignature = await sign(encodedPayload, secret);
  if (!(await constantTimeEqual(signature, expectedSignature))) return false;

  const payload = parsePayload(encodedPayload);
  if (!payload) return false;
  const nowSeconds = Math.floor(now / 1000);
  return payload.iat <= nowSeconds && payload.exp > nowSeconds;
}

function sessionSecret() {
  return process.env.COMPANY_BRAIN_SESSION_SECRET?.trim() || null;
}

function parsePayload(value: string): SessionPayload | null {
  try {
    const parsed = JSON.parse(base64UrlDecode(value)) as Partial<SessionPayload>;
    if (typeof parsed.iat !== "number" || typeof parsed.exp !== "number") return null;
    if (!Number.isFinite(parsed.iat) || !Number.isFinite(parsed.exp)) return null;
    return { iat: parsed.iat, exp: parsed.exp };
  } catch {
    return null;
  }
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(value));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

async function constantTimeEqual(left: string, right: string) {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}

function base64UrlEncode(value: string) {
  return base64UrlEncodeBytes(textEncoder.encode(value));
}

function base64UrlEncodeBytes(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}
