import type { GmailSyncRun } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { syncConservativeGmail } from "./gmailSync";


export async function startBackgroundGmailSync(input: {
  companyId: string;
  actorId?: string;
  origin?: string;
}) {
  const startedAt = new Date().toISOString();
  const lock = await tryAcquireGmailSyncLock(input.companyId);
  if (!lock) {
    const runningRun = await prisma.gmailSyncRun.findFirst({
      where: { companyId: input.companyId, status: "RUNNING" },
      orderBy: { startedAt: "desc" },
    });
    return {
      started: false as const,
      startedAt: runningRun?.startedAt.toISOString() ?? null,
    };
  }

  const promise = syncConservativeGmail(input)
    .then(() =>
      prisma.appState.upsert({
        where: { key: `gmail.backgroundSync.lastError.${input.companyId}` },
        create: { key: `gmail.backgroundSync.lastError.${input.companyId}`, value: { message: null } },
        update: { value: { message: null } },
      }),
    )
    .catch((error) =>
      prisma.appState.upsert({
        where: { key: `gmail.backgroundSync.lastError.${input.companyId}` },
        create: {
          key: `gmail.backgroundSync.lastError.${input.companyId}`,
          value: { message: error instanceof Error ? error.message : "Gmail sync failed." },
        },
        update: { value: { message: error instanceof Error ? error.message : "Gmail sync failed." } },
      }),
    )
    .finally(() => releaseGmailSyncLock(input.companyId));

  void promise;
  return { started: true as const, startedAt };
}

async function tryAcquireGmailSyncLock(companyId: string) {
  const lock = await prisma.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(hashtext(${`company-brain:gmail-sync:${companyId}`})) AS locked
  `;
  return Boolean(lock[0]?.locked);
}

async function releaseGmailSyncLock(companyId: string) {
  await prisma.$queryRaw`
    SELECT pg_advisory_unlock(hashtext(${`company-brain:gmail-sync:${companyId}`}))
  `;
}

export async function getBackgroundGmailSyncStatus(companyId: string) {
  const latestRun = await prisma.gmailSyncRun.findFirst({
    where: { companyId },
    orderBy: { startedAt: "desc" },
  });

  const runningRun = await prisma.gmailSyncRun.findFirst({
    where: { companyId, status: "RUNNING" },
    orderBy: { startedAt: "desc" },
  });
  const lastError = await prisma.appState.findUnique({
    where: { key: `gmail.backgroundSync.lastError.${companyId}` },
  });

  return {
    active: Boolean(runningRun),
    activeStartedAt: runningRun?.startedAt.toISOString() ?? null,
    lastError: lastErrorMessage(lastError?.value),
    latestRun: latestRun ? serializeSyncRun(latestRun) : null,
  };
}

function lastErrorMessage(value: unknown) {
  if (!value || typeof value !== "object" || !("message" in value)) return null;
  return typeof value.message === "string" ? value.message : null;
}

function serializeSyncRun(run: GmailSyncRun) {
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    threadsScanned: run.threadsScanned,
    threadsMatched: run.threadsMatched,
    messagesSynced: run.messagesSynced,
    attachmentsSynced: run.attachmentsSynced,
    error: run.error,
    metadata: run.metadata,
  };
}
