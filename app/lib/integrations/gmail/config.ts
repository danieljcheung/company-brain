export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_SCOPES_COMBINED = `${GMAIL_READONLY_SCOPE} ${GMAIL_SEND_SCOPE}`;

const REQUIRED_ENV = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GMAIL_TOKEN_ENCRYPTION_KEY",
] as const;

export type GmailOAuthConfig =
  | {
      configured: true;
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      scope: string;
      missing: [];
    }
  | {
      configured: false;
      clientId?: string;
      clientSecret?: string;
      redirectUri?: string;
      scope: string;
      missing: string[];
    };

export function getGmailOAuthConfig(origin?: string): GmailOAuthConfig {
  const missing: string[] = [...getGmailOAuthMissingEnv()];
  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI ??
    (origin ? `${origin}/api/auth/google/callback` : undefined);

  if (!redirectUri && !origin) missing.push("GOOGLE_OAUTH_REDIRECT_URI");

  if (missing.length || !redirectUri) {
    return {
      configured: false,
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri,
      scope: GMAIL_SCOPES_COMBINED,
      missing,
    };
  }

  return {
    configured: true,
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    redirectUri,
    scope: GMAIL_SCOPES_COMBINED,
    missing: [],
  };
}

export function describeGmailConfigError(origin?: string) {
  const config = getGmailOAuthConfig(origin);
  if (config.configured) return null;
  return `Gmail OAuth is not configured. Missing: ${config.missing.join(", ")}.`;
}

export function getGmailOAuthMissingEnv() {
  return REQUIRED_ENV.filter((key) => !process.env[key]);
}
