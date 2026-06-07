import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const requiredEnv = [
    "DATABASE_URL",
    "COMPANY_BRAIN_APP_PASSWORD",
    "COMPANY_BRAIN_SESSION_SECRET",
    "COMPANY_BRAIN_API_TOKEN",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "GMAIL_TOKEN_ENCRYPTION_KEY",
    "ZOHO_CLIENT_ID",
    "ZOHO_CLIENT_SECRET",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
  ];
  const missingEnv = requiredEnv.filter((name) => !process.env[name]?.trim());

  if (missingEnv.length > 0) {
    return NextResponse.json(
      { status: "unhealthy", error: `Missing required env variables: ${missingEnv.join(", ")}` },
      { status: 503 }
    );
  }

  try {
    // Validate PostgreSQL connectivity
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { status: "unhealthy", error: `Database connection failed: ${message}` },
      { status: 503 }
    );
  }
}
