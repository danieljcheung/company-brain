import {
  BrainReviewStatus,
  BrainSection,
  BrainSourceType,
  BrainCandidateKind,
  type Prisma,
} from "@prisma/client";
import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { FRONT_DOOR_SESSION_COOKIE, verifyFrontDoorSession } from "@/app/lib/frontDoorAuth";
import { prisma } from "@/lib/prisma";

export const DEFAULT_COMPANY_SLUG = "default-company";
const DEFAULT_COMPANY_NAME = "Default Company";
const DEFAULT_REVIEWER_EMAIL = "reviewer@local.company-brain";
const API_TOKEN_ENV = "COMPANY_BRAIN_API_TOKEN";

const SOURCE_TYPE_LABELS: Record<BrainSourceType, string> = {
  TEXT: "Text",
  MARKDOWN: "Markdown",
  CSV: "CSV",
  PDF: "PDF",
  IMAGE: "Image",
  EMAIL_EXPORT: "Email export",
  SHEET_INSPECTION: "Sheet inspection",
  OTHER: "Other",
};

const SECTION_LABELS: Record<BrainSection, string> = {
  COMPANY_PROFILE: "Company Profile",
  PEOPLE_ROLES: "People & Roles",
  CUSTOMERS: "Customers",
  VENDORS: "Vendors",
  PRODUCTS_MENU: "Products/Menu",
  PRICING_RULES: "Pricing Rules",
  EXPENSE_CATEGORIES: "Expense Categories",
  RECEIPT_RULES: "Receipt Rules",
  REIMBURSEMENT_RULES: "Reimbursement Rules",
  SHEET_MAPPINGS: "Sheet Mappings",
  WORKFLOWS: "Workflows",
  APPROVAL_RULES: "Approval Rules",
  OPEN_QUESTIONS: "Open Questions",
  SOURCE_LIBRARY: "Source Library",
};

const KIND_LABELS: Record<BrainCandidateKind, string> = {
  ENTITY: "entity",
  FACT: "fact",
  RULE: "rule",
  OPEN_QUESTION: "open_question",
  RELATIONSHIP: "relationship",
};

const STATUS_LABELS: Record<BrainReviewStatus, string> = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  NEEDS_CLARIFICATION: "needs_clarification",
  SUPERSEDED: "superseded",
};

export function mapSourceTypeLabel(value: BrainSourceType) {
  return SOURCE_TYPE_LABELS[value];
}

export function mapSectionLabel(value: BrainSection) {
  return SECTION_LABELS[value];
}

export function mapKindLabel(value: BrainCandidateKind) {
  return KIND_LABELS[value];
}

export function mapStatusLabel(value: BrainReviewStatus) {
  return STATUS_LABELS[value];
}

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

export async function requireApiAuth(request: NextRequest) {
  const session = request.cookies.get(FRONT_DOOR_SESSION_COOKIE)?.value;
  if (await verifyFrontDoorSession(session)) return null;

  const expectedToken = process.env[API_TOKEN_ENV]?.trim();
  if (!expectedToken) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "API authentication is not configured." },
        { status: 503 },
      );
    }
    return null;
  }

  const providedToken = readBearerToken(request) ?? request.headers.get("x-company-brain-api-token")?.trim();
  if (!providedToken || !constantTimeTokenEqual(providedToken, expectedToken)) {
    return NextResponse.json(
      { error: "Authentication required." },
      {
        status: 401,
        headers: { "WWW-Authenticate": "Bearer" },
      },
    );
  }

  return null;
}

function readBearerToken(request: Pick<NextRequest, "headers">) {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization) return null;
  const [scheme, token] = authorization.split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" && token ? token.trim() : null;
}

function constantTimeTokenEqual(providedToken: string, expectedToken: string) {
  const providedHash = createHash("sha256").update(providedToken).digest();
  const expectedHash = createHash("sha256").update(expectedToken).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

export function databaseUnavailableResponse() {
  return NextResponse.json(
    {
      error:
        "DATABASE_URL is not configured. Configure a Postgres DATABASE_URL to use persistence routes.",
    },
    { status: 503 },
  );
}

export async function getDefaultContext(tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;

  const company = await client.company.upsert({
    where: { slug: DEFAULT_COMPANY_SLUG },
    update: {},
    create: { slug: DEFAULT_COMPANY_SLUG, name: DEFAULT_COMPANY_NAME },
  });

  const reviewer = await client.user.upsert({
    where: { companyId_email: { companyId: company.id, email: DEFAULT_REVIEWER_EMAIL } },
    update: {},
    create: {
      companyId: company.id,
      email: DEFAULT_REVIEWER_EMAIL,
      name: "Local Reviewer",
      role: "REVIEWER",
    },
  });

  return { company, reviewer };
}
