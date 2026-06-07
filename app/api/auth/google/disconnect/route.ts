import { GmailConnectionStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { buildGmailSettingsRedirectUrl } from "@/app/lib/integrations/gmail/redirects";
import { prisma } from "@/lib/prisma";
import { databaseUnavailableResponse, getDefaultContext, hasDatabaseUrl } from "../../../brain/_shared";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();

  const { company } = await getDefaultContext();
  await prisma.gmailConnection.updateMany({
    where: { companyId: company.id },
    data: {
      status: GmailConnectionStatus.DISCONNECTED,
      historyId: null,
      lastSyncedAt: null,
      metadata: {
        disconnectedAt: new Date().toISOString(),
      },
    },
  });

  const url = buildGmailSettingsRedirectUrl(request.url);
  url.searchParams.set("gmailDisconnected", "1");
  return NextResponse.redirect(url, { status: 303 });
}
