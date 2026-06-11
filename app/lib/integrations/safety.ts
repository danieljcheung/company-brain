import { prisma } from "@/lib/prisma";

const SAFETY_MODE_KEY = "safety.mode.active";

export async function isSafetyModeActive(): Promise<boolean> {
  const state = await prisma.appState.findUnique({ where: { key: SAFETY_MODE_KEY } });
  return typeof state?.value === "boolean" ? state.value : true;
}

export async function setSafetyModeActive(active: boolean) {
  await prisma.appState.upsert({
    where: { key: SAFETY_MODE_KEY },
    create: { key: SAFETY_MODE_KEY, value: active },
    update: { value: active },
  });
  return active;
}

const truthy = new Set(["1", "true", "yes", "on"]);

export function envFlag(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return fallback;
  }

  return truthy.has(value.toLowerCase());
}

export function externalWritesAllowed(): boolean {
  return envFlag("ALLOW_EXTERNAL_WRITES", false);
}

export function externalWritesBlockedResponse(action: string) {
  return {
    error: `Blocked ${action}: ALLOW_EXTERNAL_WRITES is not enabled in the server environment.`,
  };
}

export function integrationsAreMocked(): boolean {
  return envFlag("LOCAL_INGESTION_ONLY", true);
}

export function assertNoAutonomousAction(action: string): never {
  throw new Error(
    `Blocked ${action}: Phase 1 only supports local ingestion and human review.`,
  );
}

export function safetySnapshot() {
  return {
    mockIntegrations: integrationsAreMocked(),
    allowAutonomousActions: envFlag("ALLOW_AUTONOMOUS_ACTIONS", false),
    allowExternalWrites: externalWritesAllowed(),
  };
}
