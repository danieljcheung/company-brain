import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { buildGoogleOAuthUrl } from "@/app/lib/integrations/gmail/oauth";
import { getGmailOAuthConfig } from "@/app/lib/integrations/gmail/config";
import { buildGmailSettingsRedirectUrl } from "@/app/lib/integrations/gmail/redirects";
import { databaseUnavailableResponse, hasDatabaseUrl } from "../../../brain/_shared";

export const runtime = "nodejs";

const STATE_COOKIE = "company_brain_gmail_oauth_state";

export async function GET(request: NextRequest) {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();

  const config = getGmailOAuthConfig(request.nextUrl.origin);
  if (!config.configured) {
    return redirectToSettings(
      request,
      `Gmail OAuth is not configured. Missing: ${config.missing.join(", ")}.`,
    );
  }

  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(buildGoogleOAuthUrl(config, state));
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    maxAge: 60 * 10,
    path: "/",
  });
  return response;
}

function redirectToSettings(request: NextRequest, error: string) {
  const url = buildGmailSettingsRedirectUrl(request.url);
  url.searchParams.set("gmailError", error);
  return NextResponse.redirect(url);
}
