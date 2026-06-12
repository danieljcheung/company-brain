import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Settings2,
  Shield,
  ShieldAlert,
  CheckCircle2,
  Mail,
  Cable,
  Activity,
} from "lucide-react";
import { safetySnapshot } from "../lib/integrations/safety";
import { getDefaultContext, hasDatabaseUrl } from "../api/brain/_shared";
import { prisma } from "@/lib/prisma";
import { getGmailOAuthMissingEnv } from "../lib/integrations/gmail/config";
import { summarizeGmailConnectionMetadata } from "../lib/integrations/gmail/tokenStore";
import { getZohoIntegrationConfig } from "../lib/integrations/zoho/config";
import { readZohoConnection, summarizeZohoConnection } from "../lib/integrations/zoho/tokenStore";

type SettingsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const safety = safetySnapshot();
  const params = searchParams ? await searchParams : {};
  const gmailMissingEnv = getGmailOAuthMissingEnv();
  const zohoConfig = getZohoIntegrationConfig();
  const zohoConnection = summarizeZohoConnection(await readZohoConnection());
  const zohoConnected = zohoConfig.hasRefreshToken || zohoConnection.connected;
  const zohoOrganizationId = zohoConfig.organizationId || zohoConnection.organizationId;
  const gmailData = hasDatabaseUrl()
    ? await getDefaultContext().then(async ({ company }) => {
        const [connections, syncRuns] = await Promise.all([
          prisma.gmailConnection.findMany({
            where: { companyId: company.id },
            orderBy: { updatedAt: "desc" },
          }),
          prisma.gmailSyncRun.findMany({
            where: { companyId: company.id },
            orderBy: { startedAt: "desc" },
            take: 5,
          }),
        ]);
        return { connections, syncRuns };
      })
    : { connections: [], syncRuns: [] };
  const gmailConnections = gmailData.connections;
  const sharedGmail = gmailConnections[0];
  const gmailMetadata = summarizeGmailConnectionMetadata(sharedGmail?.metadata ?? null);
  const gmailStatus = sharedGmail?.status ?? "DISCONNECTED";
  const gmailConfigured = gmailMissingEnv.length === 0;
  const gmailConnected = gmailStatus === "CONNECTED";
  const canSyncGmail = gmailConfigured && gmailConnected;
  const gmailMessage =
    getParam(params, "gmailError") ??
    getParam(params, "gmailImportError") ??
    getParam(params, "gmailSyncError") ??
    (getParam(params, "gmailConnected") ? "Shared Gmail connected in read-only mode." : null) ??
    (getParam(params, "gmailDisconnected") ? "Shared Gmail disconnected locally." : null) ??
    (getParam(params, "gmailImport")
      ? `Imported Gmail thread ${getParam(params, "thread") ?? ""}.`
      : null) ??
    (getParam(params, "gmailSync")
      ? `Gmail sync scanned ${getParam(params, "scanned") ?? "0"} threads and matched ${
          getParam(params, "matched") ?? "0"
        }.`
      : null);
  const connectorRows = [
    {
      name: zohoConfig.product === "invoice" ? "Zoho Invoice" : "Zoho Books",
      status: zohoConnected
        ? "Connected"
        : zohoConfig.configured
          ? "Ready to connect"
          : "Setup needed",
      scope: "Create invoice drafts after human approval",
      href: zohoConfig.configured ? "/api/auth/zoho/connect" : undefined,
    },
    {
      name: "Google Sheets",
      status: "Planned",
      scope: "Read catering/order context and source evidence",
    },
    {
      name: "Company Brain",
      status: "Local",
      scope: "Approved records only for agent decisions",
    },
  ];

  return (
    <main className="flex flex-col gap-6 p-4 md:p-6 bg-muted/10">
      <div className="flex items-center gap-3 border-b border-accent/25 pb-4">
        <div className="rounded-lg bg-blue-500/10 p-2.5 text-blue-500">
          <Settings2 className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Shared inbox setup, connector posture, and approval gates.
          </p>
        </div>
      </div>
      <Card className="border-accent/30 bg-card/45 shadow-sm">
        <CardHeader className="flex flex-row items-center gap-3 border-b border-accent/25 pb-4">
          <div className="rounded-md bg-emerald-500/10 p-2.5 text-emerald-500">
            <Shield className="size-4" />
          </div>
          <div className="space-y-0.5">
            <CardTitle className="text-base">Safety Posture</CardTitle>
            <CardDescription className="text-xs">
              {safety.allowExternalWrites
                ? "External writes are enabled behind approval gates."
                : "External writes are blocked by ALLOW_EXTERNAL_WRITES."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 pt-4 sm:grid-cols-3">
          <GateRow label="Autonomous actions" value={safety.allowAutonomousActions ? "Enabled" : "Blocked"} enabled={safety.allowAutonomousActions} />
          <GateRow label="External writes" value={safety.allowExternalWrites ? "Enabled" : "Blocked"} enabled={safety.allowExternalWrites} />
          <GateRow label="Approval gates" value="Required" enabled={true} />
        </CardContent>
      </Card>

      <Card className="border-accent/30 bg-card/45 shadow-sm" data-tutorial="settings-gmail">
        <CardHeader className="flex flex-row items-center gap-3 border-b border-accent/25 pb-4">
          <div className="rounded-md bg-blue-500/10 p-2.5 text-blue-500">
            <Mail className="size-4" />
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <CardTitle className="text-base">Shared Gmail</CardTitle>
              <CardDescription className="text-xs">
                Connection for scheduled Popup Pearl inbox sync and approved draft sending.
              </CardDescription>
            </div>
            <Badge variant={gmailConnected ? "default" : "secondary"} className={gmailConnected ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/20" : "bg-muted/10 text-muted-foreground border-accent/20 hover:bg-muted/20"}>
              {gmailConnected ? "Connected" : gmailConfigured ? "Ready to connect" : "Setup needed"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 pt-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <section className="grid gap-4">
              <p className="rounded-lg border bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                Gmail connection enables automatic inbox sync and manual draft reply sending.
              </p>
              {gmailConnected && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-600 dark:text-amber-500 leading-5">
                  <strong>Re-Authentication Recommended:</strong> If you connected your account prior to the email sending release, please <strong>Disconnect</strong> and <strong>Reconnect</strong> to authorize the required outgoing send permissions.
                </div>
              )}

              {!gmailConnected ? <ol className="grid gap-2 sm:grid-cols-3">
                <SetupStep
                  label="Configure env vars"
                  number="1"
                  state={gmailConfigured ? "Done" : "Missing"}
                />
                <SetupStep
                  label="Connect Gmail"
                  number="2"
                  state={gmailConnected ? "Done" : gmailConfigured ? "Next" : "Locked"}
                />
                <SetupStep
                  label="Sync inbox"
                  number="3"
                  state={canSyncGmail ? "Ready" : "Locked"}
                />
              </ol> : null}

              {gmailMessage ? (
                <p className="rounded-lg border bg-muted px-3 py-2 text-sm text-muted-foreground">
                  {gmailMessage}
                </p>
              ) : null}

              {!gmailConfigured ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-3 text-sm">
                  <div className="font-medium">Gmail setup is waiting on env vars</div>
                  <p className="mt-1 text-muted-foreground">
                    Add the missing values below before connecting Gmail or importing a
                    thread.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {gmailMissingEnv.map((envName) => (
                      <Badge key={envName} variant="outline" className="break-all text-left">
                        {envName}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2">
                <GmailFact label="Status" value={gmailStatus.toLowerCase()} />
                <GmailFact label="Account" value={sharedGmail?.email ?? "Not connected"} />
                <GmailFact label="Access" value="Read-only Gmail access" />
                <GmailFact
                  label="Connection"
                  value={
                    gmailMetadata.hasTokenState
                      ? "Connection saved securely"
                      : "Not saved yet"
                  }
                />
                <GmailFact
                  label="Connected"
                  value={formatDateTime(gmailMetadata.connectedAt)}
                />
                <GmailFact
                  label="Last import"
                  value={formatDateTime(sharedGmail?.lastSyncedAt?.toISOString())}
                />
              </div>

              {gmailMetadata.lastError ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
                  <div className="font-medium">Last Gmail error</div>
                  <p className="mt-1 break-words text-muted-foreground">
                    {gmailMetadata.lastError.message}
                  </p>
                </div>
              ) : null}
              {gmailMetadata.warnings.length ? (
                <div className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
                  {gmailMetadata.warnings.join(" ")}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {!gmailConnected && gmailConfigured ? (
                  <Button asChild>
                    <a href="/api/auth/google/connect">Connect Gmail (Send & Read)</a>
                  </Button>
                ) : !gmailConnected ? (
                  <Button disabled>Connect Gmail (Send & Read)</Button>
                ) : null}
                <form action="/api/inbox/sync/gmail" method="post">
                  <Button disabled={!canSyncGmail} type="submit">
                    Sync
                  </Button>
                </form>
                <form action="/api/auth/google/disconnect" method="post">
                  <Button
                    disabled={!sharedGmail}
                    type="submit"
                    variant="outline"
                  >
                    Disconnect
                  </Button>
                </form>
              </div>
            </section>
          </CardContent>
        </Card>

        <div>
          <Card className="border-accent/30 bg-card/45 shadow-sm" data-tutorial="settings-zoho">
            <CardHeader className="flex flex-row items-center gap-3 border-b border-accent/25 pb-4">
              <div className="rounded-md bg-indigo-500/10 p-2.5 text-indigo-500">
                <Cable className="size-4" />
              </div>
              <div className="space-y-0.5">
                <CardTitle className="text-base">Other Connectors</CardTitle>
                <CardDescription className="text-xs">Invoicing and source systems.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 pt-4">
              {connectorRows.map((connector) => (
                <article
                  className="flex items-start justify-between gap-4 rounded-lg border bg-muted/30 p-4"
                  key={connector.name}
                >
                  <div>
                    <div className="font-medium">{connector.name}</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {connector.scope}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {"href" in connector && connector.href ? (
                      <Button asChild size="sm" variant="outline">
                        <a href={connector.href}>Connect</a>
                      </Button>
                    ) : null}
                    <Badge variant="secondary">{connector.status}</Badge>
                  </div>
                </article>
              ))}
              {getParam(params, "zohoError") ? (
                <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive break-words">
                  {getParam(params, "zohoError")}
                </p>
              ) : null}
              {getParam(params, "zohoCode") ? (
                <p className="rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  Zoho returned an authorization code. Token exchange/storage is not enabled yet; add a Zoho token store before creating invoices.
                </p>
              ) : null}
              {getParam(params, "zohoConnected") ? (
                <p className="rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  Zoho connected locally
                  {zohoOrganizationId ? ` with organization ${zohoOrganizationId}` : ""}.
                  External invoice writes are still blocked.
                </p>
              ) : null}
              {getParam(params, "zohoTemplateSync") ? (
                <p className="rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  Imported template context from {getParam(params, "invoices") ?? "0"} recent Zoho invoices into Company Brain.
                </p>
              ) : null}
              {zohoConnection.organizations.length ? (
                <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  <div className="font-medium text-foreground">Zoho organizations</div>
                  <div className="mt-2 grid gap-1">
                    {zohoConnection.organizations.map((organization) => (
                      <div
                        className="flex flex-wrap items-center justify-between gap-2"
                        key={organization.organizationId}
                      >
                        <span>
                          {organization.name}
                          {organization.isDefault ? " (default)" : ""}
                        </span>
                        <code className="rounded bg-background px-1.5 py-0.5 text-xs break-all">
                          {organization.organizationId}
                        </code>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <form action="/api/integrations/zoho/invoice-template/sync" method="post">
                <Button
                  disabled={!zohoConnected || !zohoOrganizationId}
                  type="submit"
                  variant="outline"
                >
                  Import recent invoice template
                </Button>
              </form>
              <p className="text-xs text-muted-foreground">
                Reads recent Zoho invoices into Company Brain template context only. It does not create or send invoices.
              </p>
            </CardContent>
          </Card>
        </div>

          <Card className="border-accent/30 bg-card/45 shadow-sm">
            <CardHeader className="flex flex-row items-center gap-3 border-b border-accent/25 pb-4">
              <div className="rounded-md bg-zinc-500/10 p-2.5 text-zinc-500">
                <Activity className="size-4" />
              </div>
              <div className="space-y-0.5">
                <CardTitle className="text-base">Recent Gmail Runs</CardTitle>
                <CardDescription className="text-xs">Manual selected-thread imports, sync runs, and errors.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-2 pt-4">
            {gmailData.syncRuns.length ? (
              gmailData.syncRuns.map((run) => (
                <article
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                  key={run.id}
                >
                  <div>
                    <div className="font-medium">{run.status.toLowerCase()}</div>
                    <p className="text-sm text-muted-foreground">
                      {run.messagesSynced} messages, {run.attachmentsSynced} attachments
                      {run.error ? ` - ${run.error}` : ""}
                    </p>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {formatDateTime(run.startedAt.toISOString())}
                  </span>
                </article>
              ))
            ) : (
              <p className="rounded-lg border p-3 text-sm text-muted-foreground">
                No Gmail import runs yet.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
  );
}

function GateRow({ label, value, enabled }: { label: string; value: string; enabled: boolean }) {
  const Icon = enabled ? CheckCircle2 : ShieldAlert;
  const colorClass = enabled ? "text-emerald-500 bg-emerald-500/10" : "text-amber-500 bg-amber-500/10";
  return (
    <div className="flex items-center justify-between rounded-lg border border-accent/20 bg-muted/20 p-3.5 shadow-sm">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <div className={`rounded-md p-1 ${colorClass}`}>
          <Icon className="size-4 shrink-0" />
        </div>
        <strong className="text-sm font-semibold">{value}</strong>
      </div>
    </div>
  );
}
function SetupStep({
  label,
  number,
  state,
}: {
  label: string;
  number: string;
  state: string;
}) {
  const badgeClass = state === "Done" || state === "Ready"
    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
    : state === "Next"
    ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
    : "bg-muted/10 text-muted-foreground border-accent/20";
  return (
    <li className="rounded-lg border border-accent/20 bg-muted/25 p-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex size-6 items-center justify-center rounded-full bg-background border border-accent/20 text-xs font-semibold">
          {number}
        </span>
        <Badge variant="secondary" className={badgeClass}>{state}</Badge>
      </div>
      <div className="mt-2 text-sm font-semibold text-foreground leading-4">{label}</div>
    </li>
  );
}
function GmailFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-accent/25 bg-muted/20 p-3.5 shadow-sm">
      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-foreground" title={value}>
        {value}
      </div>
    </div>
  );
}

function getParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = params[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
