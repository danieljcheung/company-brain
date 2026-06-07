import { NextRequest, NextResponse } from "next/server";

import { FRONT_DOOR_SESSION_COOKIE, verifyFrontDoorSession } from "@/app/lib/frontDoorAuth";

const PUBLIC_PATH_PREFIXES = ["/_next/", "/login", "/api/auth/front-door/login", "/api/healthz", "/api/readyz"];
const PUBLIC_FILE_PATTERN = /\.(?:html|ico|png|jpg|jpeg|gif|svg|webp|css|js|map|txt|xml)$/i;

function constantTimeTokenEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  // API Token Authentication bypass for external clients/agents
  const expectedToken = process.env.COMPANY_BRAIN_API_TOKEN?.trim();
  if (expectedToken && pathname.startsWith("/api/")) {
    const authorization = request.headers.get("authorization")?.trim();
    let providedToken: string | null = null;
    if (authorization) {
      const [scheme, token] = authorization.split(/\s+/, 2);
      if (scheme?.toLowerCase() === "bearer" && token) {
        providedToken = token.trim();
      }
    } else {
      providedToken = request.headers.get("x-company-brain-api-token")?.trim() ?? null;
    }

    if (providedToken && constantTimeTokenEqual(providedToken, expectedToken)) {
      return NextResponse.next();
    }
  }

  const authenticated = await verifyFrontDoorSession(
    request.cookies.get(FRONT_DOOR_SESSION_COOKIE)?.value,
  );
  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: "Authentication required." },
      { status: 401 },
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};

function isPublicPath(pathname: string) {
  if (pathname === "/favicon.ico") return true;
  if (!pathname.startsWith("/api/") && PUBLIC_FILE_PATTERN.test(pathname)) return true;
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"));
}
