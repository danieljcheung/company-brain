export const ZOHO_BOOKS_INVOICE_SCOPES = [
  "ZohoBooks.contacts.READ",
  "ZohoBooks.invoices.READ",
  "ZohoBooks.invoices.CREATE",
  "ZohoBooks.invoices.UPDATE",
] as const;

const REQUIRED_ENV = [
  "ZOHO_CLIENT_ID",
  "ZOHO_CLIENT_SECRET",
] as const;

export type ZohoProduct = "books" | "invoice";

export type ZohoIntegrationConfig = {
  configured: boolean;
  product: ZohoProduct;
  clientId?: string;
  clientSecret?: string;
  organizationId?: string;
  redirectUri?: string;
  accountsBaseUrl: string;
  apiBaseUrl: string;
  scopes: string[];
  hasRefreshToken: boolean;
  missing: string[];
};

export function getZohoIntegrationConfig(origin?: string): ZohoIntegrationConfig {
  const product = zohoProduct();
  const missing: string[] = [...getZohoMissingEnv()];
  const envRedirectUri = process.env.ZOHO_OAUTH_REDIRECT_URI?.trim();
  const redirectUri =
    envRedirectUri ||
    (origin ? `${origin}/api/auth/zoho/callback` : undefined);

  return {
    configured: missing.length === 0 && Boolean(redirectUri || !origin),
    product,
    clientId: process.env.ZOHO_CLIENT_ID,
    clientSecret: process.env.ZOHO_CLIENT_SECRET,
    organizationId: process.env.ZOHO_ORGANIZATION_ID,
    redirectUri,
    accountsBaseUrl: process.env.ZOHO_ACCOUNTS_BASE_URL || "https://accounts.zoho.com",
    apiBaseUrl:
      process.env.ZOHO_API_BASE_URL ||
      (product === "invoice" ? "https://www.zohoapis.com/invoice/v3" : "https://www.zohoapis.com/books/v3"),
    scopes: zohoScopes(product),
    hasRefreshToken: Boolean(process.env.ZOHO_REFRESH_TOKEN?.trim()),
    missing,
  };
}

export function getZohoMissingEnv() {
  return REQUIRED_ENV.filter((key) => !process.env[key]);
}

function zohoProduct(): ZohoProduct {
  return process.env.ZOHO_PRODUCT === "books" ? "books" : "invoice";
}

function zohoScopes(product: ZohoProduct) {
  if (product === "invoice") {
    return [
      "ZohoInvoice.settings.READ",
      "ZohoInvoice.contacts.READ",
      "ZohoInvoice.contacts.CREATE",
      "ZohoInvoice.invoices.READ",
      "ZohoInvoice.invoices.CREATE",
      "ZohoInvoice.invoices.UPDATE",
    ];
  }
  return [...ZOHO_BOOKS_INVOICE_SCOPES];
}
