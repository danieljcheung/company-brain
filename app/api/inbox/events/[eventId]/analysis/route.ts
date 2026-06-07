import { requireMutationAuth } from "@/app/lib/apiAuth";
import { getRateLimit } from "@/app/lib/rateLimit";
import { NextRequest, NextResponse } from "next/server";

import { rerunInboxAgentForStoredEvent } from "@/app/lib/inbox/reanalysis";
import {
  databaseUnavailableResponse,
  getDefaultContext,
  hasDatabaseUrl,
} from "../../../../brain/_shared";

type AnalysisRouteContext = {
  params: Promise<{ eventId: string }>;
};

export async function POST(request: NextRequest, context: AnalysisRouteContext) {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();
  const unauthorized = await requireMutationAuth();
  if (unauthorized) return unauthorized;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || 
             request.headers.get("x-real-ip")?.trim() || 
             "127.0.0.1";
  const rate = getRateLimit(ip, "inbox_analysis", 5, 60 * 1000); // 5 analysis requests per minute
  if (rate.isBlocked) {
    return NextResponse.json(
      { error: `Too many reanalysis requests. Please try again in ${rate.resetInSeconds} seconds.` },
      { status: 429 },
    );
  }
  rate.increment();

  const { eventId } = await context.params;
  try {
    const { company, reviewer } = await getDefaultContext();
    const result = await rerunInboxAgentForStoredEvent({
      eventId,
      companyId: company.id,
      actorId: reviewer.id,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Inbox agent reanalysis failed.",
      },
      { status: 400 },
    );
  }
}
