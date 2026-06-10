import type { ZohoIntegrationConfig } from "./config";
import type { ZohoTokenState } from "./oauth";
import type { ZohoOrganizationSummary } from "./tokenStore";

export type ZohoInvoiceLineTemplate = {
  name: string | null;
  description: string | null;
  quantityType: string | null;
  rate: number | null;
  taxName: string | null;
  taxPercentage: number | null;
};

export type ZohoInvoiceTemplateContext = {
  source: "zoho_recent_invoices";
  syncedAt: string;
  organizationId: string;
  sampleSize: number;
  currencyCode: string | null;
  templateId: string | null;
  templateName: string | null;
  paymentTerms: string | null;
  paymentTermsLabel: string | null;
  notes: string | null;
  terms: string | null;
  discountType: string | null;
  taxTreatment: string | null;
  lineItemShape: ZohoInvoiceLineTemplate[];
};

export type ZohoContactSummary = {
  contactId: string;
  contactName: string;
  email: string | null;
  contactPersonId: string | null;
};

export type ZohoCreateInvoiceLineItem = {
  name: string;
  description?: string;
  quantity: number;
  rate: number;
};

export type ZohoCreatedInvoice = {
  invoiceId: string;
  invoiceNumber: string | null;
  status: string | null;
  invoiceUrl: string | null;
  total: number | null;
};

export type ZohoInvoiceDetail = Record<string, unknown>;

export type ZohoSentInvoiceEmail = {
  invoiceId: string;
  message: string | null;
};

export type ZohoCreateContactInput = {
  contactName: string;
  email: string;
  companyName?: string | null;
};

type ZohoOrganizationsResponse = {
  code?: number;
  message?: string;
  organizations?: Array<{
    organization_id?: string;
    name?: string;
    is_default_org?: boolean;
    currency_code?: string;
    address?: {
      country?: string;
    };
  }>;
};

type ZohoContactsResponse = {
  code?: number;
  message?: string;
  contacts?: Array<{
    contact_id?: string;
    contact_name?: string;
    email?: string;
    contact_persons?: Array<{
      contact_person_id?: string;
      email?: string;
      is_primary_contact?: boolean;
    }>;
  }>;
};

type ZohoCreateContactResponse = {
  code?: number;
  message?: string;
  contact?: {
    contact_id?: string;
    contact_name?: string;
    email?: string;
    contact_persons?: Array<{
      contact_person_id?: string;
      email?: string;
      is_primary_contact?: boolean;
    }>;
  };
  error?: { message?: string };
};

type ZohoInvoiceListResponse = {
  code?: number;
  message?: string;
  invoices?: Array<{
    invoice_id?: string;
    invoice_number?: string;
    status?: string;
    date?: string;
    total?: number;
    currency_code?: string;
    template_id?: string;
    template_name?: string;
  }>;
};

type ZohoInvoiceDetailResponse = {
  code?: number;
  message?: string;
  invoice?: ZohoInvoiceDetail;
};

type ZohoCreateInvoiceResponse = {
  code?: number;
  message?: string;
  invoice?: {
    invoice_id?: string;
    invoice_number?: string;
    status?: string;
    invoice_url?: string;
    total?: number;
  };
  error?: { message?: string };
};

type ZohoSendInvoiceEmailResponse = {
  code?: number;
  message?: string;
  error?: { message?: string };
};

export async function fetchZohoOrganizations(
  config: ZohoIntegrationConfig,
  tokenState: ZohoTokenState,
): Promise<ZohoOrganizationSummary[]> {
  const response = await fetch(zohoApiUrl(config, tokenState, "/organizations"), {
    headers: {
      Accept: "application/json",
      Authorization: `Zoho-oauthtoken ${tokenState.accessToken}`,
    },
    redirect: "manual",
  });
  const body = await readZohoJsonResponse<ZohoOrganizationsResponse & {
    error?: { message?: string };
  }>(response);

  if (!response.ok || !Array.isArray(body.organizations)) {
    throw new Error(body.error?.message ?? body.message ?? "Could not fetch Zoho organizations.");
  }

  return body.organizations
    .map((organization) => ({
      organizationId: organization.organization_id ?? "",
      name: organization.name ?? "Unnamed organization",
      isDefault: Boolean(organization.is_default_org),
      currencyCode: organization.currency_code,
      country: organization.address?.country,
    }))
    .filter((organization) => organization.organizationId);
}

export async function fetchRecentZohoInvoices(input: {
  config: ZohoIntegrationConfig;
  tokenState: ZohoTokenState;
  organizationId: string;
  limit?: number;
}) {
  const url = zohoApiUrl(input.config, input.tokenState, "/invoices");
  url.searchParams.set("organization_id", input.organizationId);
  url.searchParams.set("per_page", String(input.limit ?? 5));
  url.searchParams.set("sort_column", "created_time");
  url.searchParams.set("sort_order", "D");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Zoho-oauthtoken ${input.tokenState.accessToken}`,
    },
    redirect: "manual",
  });
  const body = await readZohoJsonResponse<ZohoInvoiceListResponse & {
    error?: { message?: string };
  }>(response);

  if (!response.ok || !Array.isArray(body.invoices)) {
    throw new Error(body.error?.message ?? body.message ?? "Could not fetch Zoho invoices.");
  }

  return body.invoices
    .map((invoice) => ({
      invoiceId: invoice.invoice_id ?? "",
      invoiceNumber: invoice.invoice_number ?? null,
      status: invoice.status ?? null,
      date: invoice.date ?? null,
      total: typeof invoice.total === "number" ? invoice.total : null,
      currencyCode: invoice.currency_code ?? null,
      templateId: invoice.template_id ?? null,
      templateName: invoice.template_name ?? null,
    }))
    .filter((invoice) => invoice.invoiceId);
}

export async function findZohoContactByEmail(input: {
  config: ZohoIntegrationConfig;
  tokenState: ZohoTokenState;
  organizationId: string;
  email: string;
}) {
  const url = zohoApiUrl(input.config, input.tokenState, "/contacts");
  url.searchParams.set("organization_id", input.organizationId);
  url.searchParams.set("email_contains", input.email);
  url.searchParams.set("per_page", "10");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Zoho-oauthtoken ${input.tokenState.accessToken}`,
    },
    redirect: "manual",
  });
  const body = await readZohoJsonResponse<ZohoContactsResponse & {
    error?: { message?: string };
  }>(response);

  if (!response.ok || !Array.isArray(body.contacts)) {
    throw new Error(body.error?.message ?? body.message ?? "Could not search Zoho contacts.");
  }

  const normalizedEmail = input.email.trim().toLowerCase();
  return body.contacts
    .map((contact): ZohoContactSummary => ({
      contactId: contact.contact_id ?? "",
      contactName: contact.contact_name ?? "Unnamed contact",
      email: contact.email ?? null,
      contactPersonId: contactPersonIdForEmail(contact.contact_persons, normalizedEmail),
    }))
    .filter((contact) => contact.contactId)
    .find((contact) => contact.email?.toLowerCase() === normalizedEmail) ?? null;
}

export async function createZohoContact(input: {
  config: ZohoIntegrationConfig;
  tokenState: ZohoTokenState;
  organizationId: string;
  contact: ZohoCreateContactInput;
}) {
  const url = zohoApiUrl(input.config, input.tokenState, "/contacts");
  url.searchParams.set("organization_id", input.organizationId);
  const [firstName, ...lastNameParts] = input.contact.contactName.trim().split(/\s+/);
  const payload = {
    contact_name: input.contact.companyName || input.contact.contactName,
    company_name: input.contact.companyName || undefined,
    contact_type: "customer",
    contact_persons: [
      {
        first_name: firstName || input.contact.contactName,
        last_name: lastNameParts.join(" ") || undefined,
        email: input.contact.email,
        is_primary_contact: true,
      },
    ],
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Zoho-oauthtoken ${input.tokenState.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    redirect: "manual",
  });
  const body = await readZohoJsonResponse<ZohoCreateContactResponse>(response);

  if (!response.ok || !body.contact?.contact_id) {
    throw new Error(body.error?.message ?? body.message ?? "Could not create Zoho contact.");
  }

  return {
    contactId: body.contact.contact_id,
    contactName: body.contact.contact_name ?? input.contact.contactName,
    email: body.contact.email ?? input.contact.email,
    contactPersonId:
      contactPersonIdForEmail(body.contact.contact_persons, input.contact.email) ??
      body.contact.contact_persons?.find((person) => person.is_primary_contact)?.contact_person_id ??
      null,
  } satisfies ZohoContactSummary;
}

export async function fetchZohoInvoiceDetail(input: {
  config: ZohoIntegrationConfig;
  tokenState: ZohoTokenState;
  organizationId: string;
  invoiceId: string;
}) {
  const url = zohoApiUrl(input.config, input.tokenState, `/invoices/${input.invoiceId}`);
  url.searchParams.set("organization_id", input.organizationId);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Zoho-oauthtoken ${input.tokenState.accessToken}`,
    },
    redirect: "manual",
  });
  const body = await readZohoJsonResponse<ZohoInvoiceDetailResponse & {
    error?: { message?: string };
  }>(response);

  if (!response.ok || !body.invoice) {
    throw new Error(body.error?.message ?? body.message ?? "Could not fetch Zoho invoice detail.");
  }

  return body.invoice;
}

export async function createZohoInvoice(input: {
  config: ZohoIntegrationConfig;
  tokenState: ZohoTokenState;
  organizationId: string;
  customerId: string;
  date: string;
  lineItems: ZohoCreateInvoiceLineItem[];
  templateId?: string | null;
  contactPersonIds?: string[];
  notes?: string | null;
  terms?: string | null;
  paymentTerms?: string | null;
  referenceNumber?: string | null;
}) {
  const url = zohoApiUrl(input.config, input.tokenState, "/invoices");
  url.searchParams.set("organization_id", input.organizationId);

  const payload = {
    customer_id: input.customerId,
    date: input.date,
    reference_number: input.referenceNumber ?? undefined,
    template_id: input.templateId ?? undefined,
    payment_terms_label: input.paymentTerms ?? undefined,
    notes: input.notes ?? undefined,
    terms: input.terms ?? undefined,
    contact_persons: input.contactPersonIds?.length ? input.contactPersonIds : undefined,
    line_items: input.lineItems.map((line) => ({
      name: line.name,
      description: line.description ?? line.name,
      quantity: line.quantity,
      rate: line.rate,
    })),
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Zoho-oauthtoken ${input.tokenState.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    redirect: "manual",
  });
  const body = await readZohoJsonResponse<ZohoCreateInvoiceResponse>(response);

  if (!response.ok || !body.invoice?.invoice_id) {
    throw new Error(body.error?.message ?? body.message ?? "Could not create Zoho invoice.");
  }

  return {
    invoiceId: body.invoice.invoice_id,
    invoiceNumber: body.invoice.invoice_number ?? null,
    status: body.invoice.status ?? null,
    invoiceUrl: body.invoice.invoice_url ?? null,
    total: typeof body.invoice.total === "number" ? body.invoice.total : null,
  } satisfies ZohoCreatedInvoice;
}

export async function updateZohoInvoiceContactPersons(input: {
  config: ZohoIntegrationConfig;
  tokenState: ZohoTokenState;
  organizationId: string;
  invoiceId: string;
  customerId: string;
  contactPersonIds: string[];
}) {
  const url = zohoApiUrl(input.config, input.tokenState, `/invoices/${input.invoiceId}`);
  url.searchParams.set("organization_id", input.organizationId);

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      Authorization: `Zoho-oauthtoken ${input.tokenState.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      customer_id: input.customerId,
      contact_persons: input.contactPersonIds,
    }),
    redirect: "manual",
  });
  const body = await readZohoJsonResponse<ZohoCreateInvoiceResponse>(response);

  if (!response.ok || (typeof body.code === "number" && body.code !== 0)) {
    throw new Error(body.error?.message ?? body.message ?? "Could not update Zoho invoice contact persons.");
  }
}

export async function sendZohoInvoiceEmail(input: {
  config: ZohoIntegrationConfig;
  tokenState: ZohoTokenState;
  organizationId: string;
  invoiceId: string;
  toMailIds: string[];
}) {
  const url = zohoApiUrl(input.config, input.tokenState, `/invoices/${input.invoiceId}/email`);
  url.searchParams.set("organization_id", input.organizationId);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Zoho-oauthtoken ${input.tokenState.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to_mail_ids: input.toMailIds,
      send_from_org_email_id: true,
    }),
    redirect: "manual",
  });
  const body = await readZohoJsonResponse<ZohoSendInvoiceEmailResponse>(response);

  if (!response.ok || (typeof body.code === "number" && body.code !== 0)) {
    throw new Error(body.error?.message ?? body.message ?? "Could not send Zoho invoice email.");
  }

  return {
    invoiceId: input.invoiceId,
    message: body.message ?? null,
  } satisfies ZohoSentInvoiceEmail;
}

export function buildZohoInvoiceTemplateContext(input: {
  organizationId: string;
  invoices: Record<string, unknown>[];
  syncedAt?: string;
}): ZohoInvoiceTemplateContext {
  const newest = input.invoices[0] ?? {};
  const lineItems = input.invoices
    .flatMap((invoice) => (Array.isArray(invoice.line_items) ? invoice.line_items : []))
    .filter(isRecord)
    .map((line): ZohoInvoiceLineTemplate => ({
      name: stringValue(line.name),
      description: stringValue(line.description),
      quantityType: stringValue(line.quantity_type),
      rate: numberValue(line.rate),
      taxName: stringValue(line.tax_name),
      taxPercentage: numberValue(line.tax_percentage),
    }))
    .filter(
      (line, index, items) =>
        index ===
        items.findIndex(
          (candidate) =>
            candidate.name === line.name &&
            candidate.description === line.description &&
            candidate.rate === line.rate,
        ),
    )
    .slice(0, 60);

  return {
    source: "zoho_recent_invoices",
    syncedAt: input.syncedAt ?? new Date().toISOString(),
    organizationId: input.organizationId,
    sampleSize: input.invoices.length,
    currencyCode: stringValue(newest.currency_code),
    templateId: stringValue(newest.template_id),
    templateName: stringValue(newest.template_name),
    paymentTerms:
      stringValue(newest.payment_terms_label) ?? stringValue(newest.payment_terms),
    paymentTermsLabel: stringValue(newest.payment_terms_label),
    notes: stringValue(newest.notes),
    terms: stringValue(newest.terms),
    discountType: stringValue(newest.discount_type),
    taxTreatment: stringValue(newest.tax_treatment),
    lineItemShape: lineItems,
  };
}

export function pickDefaultZohoOrganization(organizations: ZohoOrganizationSummary[]) {
  return organizations.find((organization) => organization.isDefault) ?? organizations[0] ?? null;
}

function contactPersonIdForEmail(
  contactPersons: Array<{ contact_person_id?: string; email?: string; is_primary_contact?: boolean }> | undefined,
  email: string,
) {
  const normalizedEmail = email.trim().toLowerCase();
  return (
    contactPersons?.find((person) => person.email?.trim().toLowerCase() === normalizedEmail)?.contact_person_id ??
    null
  );
}

function zohoApiUrl(config: ZohoIntegrationConfig, tokenState: ZohoTokenState, path: string) {
  const baseUrl = tokenState.apiDomain
    ? new URL("/invoice/v3", tokenState.apiDomain)
    : new URL(config.apiBaseUrl);
  return new URL(path.replace(/^\//, ""), `${baseUrl.toString().replace(/\/$/, "")}/`);
}

async function readZohoJsonResponse<T>(response: Response): Promise<T> {
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    throw new Error(
      location
        ? `Zoho API redirected instead of returning JSON: ${location}`
        : `Zoho API returned redirect status ${response.status}.`,
    );
  }

  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const snippet = text
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    throw new Error(
      snippet
        ? `Zoho API returned HTML instead of JSON: ${snippet}`
        : `Zoho API returned ${response.status} ${response.statusText || "non-JSON response"}.`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
