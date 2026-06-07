import { NextRequest, NextResponse } from "next/server";
import { requireMutationAuth } from "@/app/lib/apiAuth";
import { syncConservativeGmail } from "@/app/lib/inbox/gmailSync";
import { buildGmailSettingsRedirectUrl } from "@/app/lib/integrations/gmail/redirects";
import { databaseUnavailableResponse, getDefaultContext, hasDatabaseUrl } from "../../../brain/_shared";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();
  const unauthorized = await requireMutationAuth();
  if (unauthorized) return unauthorized;

  try {
    const { company, reviewer } = await getDefaultContext();
    const result = await syncConservativeGmail({
      companyId: company.id,
      actorId: reviewer.id,
      origin: request.nextUrl.origin,
    });

    if (isFormRequest(request)) {
      const url = buildGmailSettingsRedirectUrl(request.url);
      url.searchParams.set("gmailSync", "success");
      url.searchParams.set("matched", String(result.threadsMatched));
      url.searchParams.set("scanned", String(result.threadsScanned));
      return NextResponse.redirect(url, { status: 303 });
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail sync failed.";
    if (isFormRequest(request)) {
      const url = buildGmailSettingsRedirectUrl(request.url);
      url.searchParams.set("gmailSyncError", message);
      return NextResponse.redirect(url, { status: 303 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function isFormRequest(request: NextRequest) {
  return request.headers.get("content-type")?.includes("application/x-www-form-urlencoded");
}
