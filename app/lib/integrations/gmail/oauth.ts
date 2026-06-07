import { GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE, type GmailOAuthConfig } from "./config";

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

export type GmailProfile = {
  emailAddress: string;
  messagesTotal?: number;
  threadsTotal?: number;
  historyId?: string;
};

export function buildGoogleOAuthUrl(config: GmailOAuthConfig & { configured: true }, state: string) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  return url;
}

export async function exchangeAuthorizationCode(
  config: GmailOAuthConfig & { configured: true },
  code: string,
) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokenResponse = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || !tokenResponse.access_token) {
    throw new Error(
      tokenResponse.error_description ??
        tokenResponse.error ??
        "Google OAuth token exchange failed.",
    );
  }

  assertReadOnlyGmailScope(tokenResponse.scope);

  return {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    expiresAt: tokenResponse.expires_in
      ? new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
      : undefined,
    scope: tokenResponse.scope ?? GMAIL_READONLY_SCOPE,
    tokenType: tokenResponse.token_type,
  };
}

export async function refreshAccessToken(
  config: GmailOAuthConfig & { configured: true },
  refreshToken: string,
) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokenResponse = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || !tokenResponse.access_token) {
    throw new Error(
      tokenResponse.error_description ??
        tokenResponse.error ??
        "Google OAuth token refresh failed.",
    );
  }

  assertReadOnlyGmailScope(tokenResponse.scope);

  return {
    accessToken: tokenResponse.access_token,
    expiresAt: tokenResponse.expires_in
      ? new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
      : undefined,
    scope: tokenResponse.scope ?? GMAIL_READONLY_SCOPE,
    tokenType: tokenResponse.token_type,
  };
}

export async function fetchGmailProfile(accessToken: string): Promise<GmailProfile> {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json()) as Partial<GmailProfile> & { error?: { message?: string } };
  if (!response.ok || !body.emailAddress) {
    throw new Error(body.error?.message ?? "Could not read Gmail profile.");
  }
  return body as GmailProfile;
}

export function assertReadOnlyGmailScope(scope?: string) {
  if (!scope) return;
  const scopes = scope.split(/\s+/).filter(Boolean);
  const unsafeScope = scopes.find(
    (value) =>
      value.startsWith("https://www.googleapis.com/auth/gmail.") &&
      value !== GMAIL_READONLY_SCOPE &&
      value !== GMAIL_SEND_SCOPE,
  );
  if (unsafeScope || scopes.includes("https://mail.google.com/")) {
    throw new Error("Gmail OAuth returned a non-read-only scope. Connection refused.");
  }
}
