import { BrainSection } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  databaseUnavailableResponse,
  getDefaultContext,
  hasDatabaseUrl,
} from "@/app/api/brain/_shared";
import { prisma } from "@/lib/prisma";

const TEMPLATE_RECORD_TITLE = "Zoho invoice template context";

export async function GET() {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();

  const { company } = await getDefaultContext();
  const record = await prisma.brainRecord.findFirst({
    where: {
      companyId: company.id,
      section: BrainSection.WORKFLOWS,
      title: TEMPLATE_RECORD_TITLE,
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({
    synced: Boolean(record),
    record: record
      ? {
          id: record.id,
          title: record.title,
          body: record.body,
          structuredData: record.structuredData,
          updatedAt: record.updatedAt.toISOString(),
        }
      : null,
  });
}
