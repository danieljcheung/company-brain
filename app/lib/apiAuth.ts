import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";

import { FRONT_DOOR_SESSION_COOKIE, verifyFrontDoorSession } from "./frontDoorAuth";

export async function requireMutationAuth() {
  const authorization = (await headers()).get("authorization");
  const token = process.env.COMPANY_BRAIN_API_TOKEN?.trim();
  if (token && authorization === `Bearer ${token}`) return null;

  const session = (await cookies()).get(FRONT_DOOR_SESSION_COOKIE)?.value;
  if (await verifyFrontDoorSession(session)) return null;

  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}
