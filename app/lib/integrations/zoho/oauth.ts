import type { ZohoIntegrationConfig } from "./config";

type ZohoTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  api_domain?: string;
  error?: string;
  error_description?: string;
};

export type ZohoTokenState = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
  tokenType?: string;
  apiDomain?: string;
};

export function buildZohoOAuthUrl(config: ZohoIntegrationConfig, state: string) {
  const url = new URL("/oauth/v2/auth", config.accountsBaseUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId ?? "");
  url.searchParams.set("redirect_uri", config.redirectUri ?? "");
  url.searchParams.set("scope", config.scopes.join(","));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url;
}

export async function exchangeZohoAuthorizationCode(
  config: ZohoIntegrationConfig,
  code: string,
): Promise<ZohoTokenState> {
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    throw new Error("Zoho OAuth is not configured.");
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
  });

  const response = await fetch(new URL("/oauth/v2/token", config.accountsBaseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual",
  });
  const tokenResponse = await readZohoJsonResponse<ZohoTokenResponse>(response);
  if (!response.ok || !tokenResponse.access_token) {
    throw new Error(
      tokenResponse.error_description ??
        tokenResponse.error ??
        "Zoho OAuth token exchange failed.",
    );
  }

  return {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    expiresAt: tokenResponse.expires_in
      ? new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
      : undefined,
    scope: tokenResponse.scope,
    tokenType: tokenResponse.token_type,
    apiDomain: tokenResponse.api_domain,
  };
}

export async function refreshZohoAccessToken(
  config: ZohoIntegrationConfig,
  refreshToken: string,
): Promise<ZohoTokenState> {
  if (!config.clientId || !config.clientSecret) {
    throw new Error("Zoho OAuth is not configured.");
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(new URL("/oauth/v2/token", config.accountsBaseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual",
  });
  const tokenResponse = await readZohoJsonResponse<ZohoTokenResponse>(response);
  if (!response.ok || !tokenResponse.access_token) {
    throw new Error(
      tokenResponse.error_description ??
        tokenResponse.error ??
        "Zoho OAuth token refresh failed.",
    );
  }

  return {
    accessToken: tokenResponse.access_token,
    refreshToken,
    expiresAt: tokenResponse.expires_in
      ? new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
      : undefined,
    scope: tokenResponse.scope,
    tokenType: tokenResponse.token_type,
    apiDomain: tokenResponse.api_domain,
  };
}

async function readZohoJsonResponse<T extends { error?: string; error_description?: string }>(
  response: Response,
): Promise<T> {
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    throw new Error(
      location
        ? `Zoho OAuth redirected instead of returning JSON: ${location}`
        : `Zoho OAuth returned redirect status ${response.status}.`,
    );
  }

  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const snippet = text
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    throw new Error(
      snippet
        ? `Zoho OAuth returned HTML instead of JSON: ${snippet}`
        : `Zoho OAuth returned ${response.status} ${response.statusText || "non-JSON response"}.`,
    );
  }
}
