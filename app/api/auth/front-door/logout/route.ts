import { NextResponse } from "next/server";

import { FRONT_DOOR_SESSION_COOKIE } from "@/app/lib/frontDoorAuth";

export const runtime = "edge";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: FRONT_DOOR_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
  return response;
}
