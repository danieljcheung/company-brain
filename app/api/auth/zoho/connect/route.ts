import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { getZohoIntegrationConfig } from "@/app/lib/integrations/zoho/config";
import { buildZohoOAuthUrl } from "@/app/lib/integrations/zoho/oauth";

export const runtime = "nodejs";

const STATE_COOKIE = "company_brain_zoho_oauth_state";

export async function GET(request: NextRequest) {
  const config = getZohoIntegrationConfig(request.nextUrl.origin);
  if (!config.configured) {
    const url = new URL("/settings", request.url);
    url.searchParams.set("zohoError", `Zoho OAuth is not configured. Missing: ${config.missing.join(", ")}.`);
    return NextResponse.redirect(url);
  }

  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(buildZohoOAuthUrl(config, state));
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    maxAge: 60 * 10,
    path: "/",
  });
  return response;
}
