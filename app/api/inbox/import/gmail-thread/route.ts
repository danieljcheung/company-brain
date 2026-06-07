import { NextRequest, NextResponse } from "next/server";
import { requireMutationAuth } from "@/app/lib/apiAuth";
import { importSelectedGmailThread } from "@/app/lib/inbox/gmailImport";
import { buildGmailSettingsRedirectUrl } from "@/app/lib/integrations/gmail/redirects";
import { databaseUnavailableResponse, getDefaultContext, hasDatabaseUrl } from "../../../brain/_shared";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();
  const unauthorized = await requireMutationAuth();
  if (unauthorized) return unauthorized;

  try {
    const body = await readImportRequest(request);
    if (!body.gmailThreadId) {
      throw new Error("Enter a Gmail thread id to import.");
    }

    const { company, reviewer } = await getDefaultContext();
    const result = await importSelectedGmailThread({
      companyId: company.id,
      actorId: reviewer.id,
      gmailThreadId: body.gmailThreadId,
      force: body.force,
      note: body.note,
      origin: request.nextUrl.origin,
    });

    if (body.responseMode === "redirect") {
      const url = buildGmailSettingsRedirectUrl(request.url);
      url.searchParams.set("gmailImport", "success");
      url.searchParams.set("thread", result.thread.gmailThreadId);
      return NextResponse.redirect(url, { status: 303 });
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail thread import failed.";
    if (isFormRequest(request)) {
      const url = buildGmailSettingsRedirectUrl(request.url);
      url.searchParams.set("gmailImportError", message);
      return NextResponse.redirect(url, { status: 303 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

async function readImportRequest(request: NextRequest) {
  if (isFormRequest(request)) {
    const form = await request.formData();
    return {
      gmailThreadId: String(form.get("gmailThreadId") ?? "").trim(),
      force: form.get("force") !== null,
      note: String(form.get("note") ?? "").trim() || undefined,
      responseMode: "redirect" as const,
    };
  }

  const text = await request.text();
  const json = text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {};
  return {
    gmailThreadId: typeof json.gmailThreadId === "string" ? json.gmailThreadId.trim() : "",
    force: typeof json.force === "boolean" ? json.force : true,
    note: typeof json.note === "string" ? json.note : undefined,
    responseMode: "json" as const,
  };
}

function isFormRequest(request: NextRequest) {
  return request.headers.get("content-type")?.includes("application/x-www-form-urlencoded");
}
