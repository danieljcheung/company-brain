import { GmailConnectionStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import {
  exchangeAuthorizationCode,
  fetchGmailProfile,
} from "@/app/lib/integrations/gmail/oauth";
import { getGmailOAuthConfig, GMAIL_READONLY_SCOPE } from "@/app/lib/integrations/gmail/config";
import {
  readTokenStateFromMetadata,
  toPrismaJsonObject,
  writeTokenStateMetadata,
} from "@/app/lib/integrations/gmail/tokenStore";
import { buildGmailSettingsRedirectUrl } from "@/app/lib/integrations/gmail/redirects";
import { prisma } from "@/lib/prisma";
import { databaseUnavailableResponse, getDefaultContext, hasDatabaseUrl } from "../../../brain/_shared";

export const runtime = "nodejs";

const STATE_COOKIE = "company_brain_gmail_oauth_state";

export async function GET(request: NextRequest) {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();

  const expectedState = request.cookies.get(STATE_COOKIE)?.value;
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const oauthError = request.nextUrl.searchParams.get("error");

  if (oauthError) return redirectToSettings(request, `Google OAuth error: ${oauthError}`);
  if (!expectedState || expectedState !== state) {
    return redirectToSettings(request, "Google OAuth state check failed.");
  }
  if (!code) return redirectToSettings(request, "Google OAuth callback did not include a code.");

  const config = getGmailOAuthConfig(request.nextUrl.origin);
  if (!config.configured) {
    return redirectToSettings(
      request,
      `Gmail OAuth is not configured. Missing: ${config.missing.join(", ")}.`,
    );
  }

  try {
    const tokenState = await exchangeAuthorizationCode(config, code);
    const profile = await fetchGmailProfile(tokenState.accessToken);

    await prisma.$transaction(async (tx) => {
      const { company } = await getDefaultContext(tx);
      const existing = await tx.gmailConnection.findFirst({
        where: { companyId: company.id, email: profile.emailAddress },
      });

      let refreshToken = tokenState.refreshToken;
      if (!refreshToken && existing) {
        try {
          refreshToken = readTokenStateFromMetadata(existing.metadata).refreshToken;
        } catch {
          refreshToken = undefined;
        }
      }

      const warnings = refreshToken
        ? []
        : ["Google did not return a refresh token; reconnect if imports stop after token expiry."];
      const metadata = writeTokenStateMetadata(
        existing?.metadata ?? null,
        {
          ...tokenState,
          refreshToken,
          scope: tokenState.scope ?? GMAIL_READONLY_SCOPE,
        },
        { warnings },
      );
      metadata.oauth = {
        ...metadata.oauth,
        lastProfileCheckAt: new Date().toISOString(),
      };

      if (existing) {
        await tx.gmailConnection.update({
          where: { id: existing.id },
          data: {
            providerAccountId: profile.emailAddress,
            status: GmailConnectionStatus.CONNECTED,
            historyId: profile.historyId,
            metadata: toPrismaJsonObject(metadata),
          },
        });
      } else {
        await tx.gmailConnection.create({
          data: {
            companyId: company.id,
            email: profile.emailAddress,
            providerAccountId: profile.emailAddress,
            status: GmailConnectionStatus.CONNECTED,
            historyId: profile.historyId,
            metadata: toPrismaJsonObject(metadata),
          },
        });
      }
    });

    const response = redirectToSettings(request, null);
    response.cookies.delete(STATE_COOKIE);
    return response;
  } catch (error) {
    return redirectToSettings(
      request,
      error instanceof Error ? error.message : "Gmail OAuth callback failed.",
    );
  }
}

function redirectToSettings(request: NextRequest, error: string | null) {
  const url = buildGmailSettingsRedirectUrl(request.url);
  if (error) url.searchParams.set("gmailError", error);
  else url.searchParams.set("gmailConnected", "1");
  return NextResponse.redirect(url);
}
