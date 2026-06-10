import { NextRequest, NextResponse } from "next/server";

import { getZohoIntegrationConfig } from "@/app/lib/integrations/zoho/config";
import { readZohoConnection, summarizeZohoConnection } from "@/app/lib/integrations/zoho/tokenStore";

export async function GET(request: NextRequest) {
  const config = getZohoIntegrationConfig(request.nextUrl.origin);
  const storedConnection = await readZohoConnection();
  const storedSummary = summarizeZohoConnection(storedConnection);
  const organizationId = config.organizationId || storedSummary.organizationId;

  return NextResponse.json({
    product: config.product,
    configured: config.configured,
    connected: config.hasRefreshToken || storedSummary.connected,
    organizationId: organizationId || null,
    organizations: storedSummary.organizations,
    apiBaseUrl: config.apiBaseUrl,
    apiDomain: storedSummary.apiDomain,
    scopes: config.scopes,
    missing: [
      ...config.missing,
      ...(!organizationId ? ["ZOHO_ORGANIZATION_ID"] : []),
    ],
    externalWritesEnabled: true,
    canCreateInvoice:
      config.configured &&
      Boolean(organizationId) &&
      (config.hasRefreshToken || storedSummary.connected),
  });
}
