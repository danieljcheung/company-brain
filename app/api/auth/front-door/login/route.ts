import { NextRequest, NextResponse } from "next/server";

import {
  createFrontDoorSession,
  FRONT_DOOR_SESSION_COOKIE,
  FRONT_DOOR_SESSION_TTL_SECONDS,
  frontDoorMissingConfig,
  verifyFrontDoorPassword,
} from "@/app/lib/frontDoorAuth";
import { getRateLimit } from "@/app/lib/rateLimit";

export const runtime = "edge";

export async function POST(request: NextRequest) {
  const missing = frontDoorMissingConfig();
  if (missing.length) {
    console.error(`Front door configuration error. Missing: ${missing.join(", ")}`);
    return NextResponse.json(
      { ok: false, error: "Front door authentication is not properly configured on the server." },
      { status: 503 },
    );
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || 
             request.headers.get("x-real-ip")?.trim() || 
             "127.0.0.1";
  const rate = getRateLimit(ip, "login_failures", 5, 60 * 1000);
  if (rate.isBlocked) {
    return NextResponse.json(
      { ok: false, error: `Too many failed login attempts. Please try again in ${rate.resetInSeconds} seconds.` },
      { status: 429 },
    );
  }

  const payload = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof payload?.password === "string" ? payload.password : "";
  if (!(await verifyFrontDoorPassword(password))) {
    rate.increment();
    return NextResponse.json({ ok: false, error: "Invalid password." }, { status: 401 });
  }

  rate.reset();
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: FRONT_DOOR_SESSION_COOKIE,
    value: await createFrontDoorSession(),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: FRONT_DOOR_SESSION_TTL_SECONDS,
    path: "/",
  });
  return response;
}
