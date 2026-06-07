import { NextRequest, NextResponse } from "next/server";
import { externalWritesAllowed, isSafetyModeActive, setSafetyModeActive } from "@/app/lib/integrations/safety";
import { requireMutationAuth } from "@/app/lib/apiAuth";
import { databaseUnavailableResponse, hasDatabaseUrl } from "../../brain/_shared";

export async function GET() {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();
  const active = await isSafetyModeActive();
  const envWritesAllowed = externalWritesAllowed();
  return NextResponse.json({ active, envWritesAllowed });
}

export async function POST(request: NextRequest) {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();
  const unauthorized = await requireMutationAuth();
  if (unauthorized) return unauthorized;

  const payload = (await request.json().catch(() => ({}))) as { active?: unknown };
  const active = await setSafetyModeActive(payload.active !== false);

  const envWritesAllowed = externalWritesAllowed();
  return NextResponse.json({ ok: true, active, envWritesAllowed });
}
