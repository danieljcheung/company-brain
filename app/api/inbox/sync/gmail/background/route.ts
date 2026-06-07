import { NextRequest, NextResponse } from "next/server";
import { requireMutationAuth } from "@/app/lib/apiAuth";

import {
  getBackgroundGmailSyncStatus,
  startBackgroundGmailSync,
} from "@/app/lib/inbox/backgroundGmailSync";
import {
  databaseUnavailableResponse,
  getDefaultContext,
  hasDatabaseUrl,
} from "../../../../brain/_shared";

export const runtime = "nodejs";

export async function GET() {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();

  const { company } = await getDefaultContext();
  return NextResponse.json(await getBackgroundGmailSyncStatus(company.id));
}

export async function POST(request: NextRequest) {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();
  const unauthorized = await requireMutationAuth();
  if (unauthorized) return unauthorized;

  const { company, reviewer } = await getDefaultContext();
  const result = await startBackgroundGmailSync({
    companyId: company.id,
    actorId: reviewer.id,
    origin: request.nextUrl.origin,
  });
  const status = await getBackgroundGmailSyncStatus(company.id);

  return NextResponse.json(
    {
      ...status,
      started: result.started,
      startedAt: result.startedAt,
    },
    { status: result.started ? 202 : 200 },
  );
}
