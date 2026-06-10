import { NextRequest, NextResponse } from "next/server";

import { fetchZohoOrganizations, pickDefaultZohoOrganization } from "@/app/lib/integrations/zoho/client";
import { getZohoIntegrationConfig } from "@/app/lib/integrations/zoho/config";
import { exchangeZohoAuthorizationCode } from "@/app/lib/integrations/zoho/oauth";
import { readZohoConnection, writeZohoConnection } from "@/app/lib/integrations/zoho/tokenStore";

const STATE_COOKIE = "company_brain_zoho_oauth_state";

export async function GET(request: NextRequest) {
  const expectedState = request.cookies.get(STATE_COOKIE)?.value;
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const config = getZohoIntegrationConfig(request.nextUrl.origin);
  const url = settingsRedirectUrl(request, config);

  if (!expectedState || expectedState !== state) {
    url.searchParams.set("zohoError", "Zoho OAuth state did not match. Try connecting again.");
    return NextResponse.redirect(url);
  }

  if (!code) {
    url.searchParams.set("zohoError", request.nextUrl.searchParams.get("error") ?? "Zoho did not return an authorization code.");
    return NextResponse.redirect(url);
  }

  try {
    if (!config.configured) {
      url.searchParams.set("zohoError", `Zoho OAuth is not configured. Missing: ${config.missing.join(", ")}.`);
      return NextResponse.redirect(url);
    }

    const tokenState = await exchangeZohoAuthorizationCode(config, code);
    const organizations = await fetchZohoOrganizations(config, tokenState);
    const selectedOrganization = pickDefaultZohoOrganization(organizations);
    await writeZohoConnection(tokenState, {
      existing: await readZohoConnection(),
      organizationId: config.organizationId || selectedOrganization?.organizationId,
      organizations,
    });

    url.searchParams.set("zohoConnected", "1");
    if (selectedOrganization?.organizationId) {
      url.searchParams.set("zohoOrg", selectedOrganization.organizationId);
    }
    const response = NextResponse.redirect(url);
    response.cookies.delete(STATE_COOKIE);
    return response;
  } catch (error) {
    url.searchParams.set(
      "zohoError",
      error instanceof Error ? error.message : "Zoho OAuth callback failed.",
    );
    return NextResponse.redirect(url);
  }
}

function settingsRedirectUrl(request: NextRequest, config = getZohoIntegrationConfig(request.nextUrl.origin)) {
  const origin = config.redirectUri
    ? new URL(config.redirectUri).origin
    : request.nextUrl.origin;
  return new URL("/settings", origin);
}
