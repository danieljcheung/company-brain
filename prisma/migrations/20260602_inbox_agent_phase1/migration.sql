-- CreateEnum
CREATE TYPE "GmailConnectionStatus" AS ENUM ('DISCONNECTED', 'CONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "GmailSyncRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "GmailThreadTrackStatus" AS ENUM ('UNTRACKED', 'TRACKED', 'IGNORED');

-- CreateEnum
CREATE TYPE "InboxEventStatus" AS ENUM ('NEEDS_REPLY', 'AWAITING_CUSTOMER', 'INVOICE_READY', 'MANUAL_REVIEW', 'COMPLETE');

-- CreateEnum
CREATE TYPE "InboxDraftStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENT', 'REJECTED');

-- CreateEnum
CREATE TYPE "InboxActionType" AS ENUM ('CREATED', 'MANUAL_IMPORTED', 'CLASSIFIED', 'STATUS_CHANGED', 'DRAFT_GENERATED', 'DRAFT_REGENERATED', 'DRAFT_REJECTED', 'DRAFT_APPROVED', 'EMAIL_SENT', 'MARKED_COMPLETE', 'REOPENED', 'POSSIBLE_LINK_SUGGESTED', 'POSSIBLE_LINK_ACCEPTED', 'POSSIBLE_LINK_REJECTED');

-- CreateEnum
CREATE TYPE "InboxEvidenceKind" AS ENUM ('GMAIL_MESSAGE', 'GMAIL_ATTACHMENT', 'BRAIN_RECORD', 'SIMILAR_THREAD', 'EXTRACTED_FIELD', 'READINESS_CHECK');

-- CreateEnum
CREATE TYPE "InboxEventSource" AS ENUM ('WORDPRESS_BOOKING_FORM', 'NEW_BOOKING_REQUEST', 'DIRECT_CATERING_INTENT', 'MANUAL_IMPORT');

-- CreateTable
CREATE TABLE "GmailConnection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT,
    "providerAccountId" TEXT,
    "status" "GmailConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "historyId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailSyncRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "connectionId" TEXT,
    "status" "GmailSyncRunStatus" NOT NULL DEFAULT 'PENDING',
    "syncWindowStart" TIMESTAMP(3),
    "syncWindowEnd" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "threadsScanned" INTEGER NOT NULL DEFAULT 0,
    "threadsMatched" INTEGER NOT NULL DEFAULT 0,
    "messagesSynced" INTEGER NOT NULL DEFAULT 0,
    "attachmentsSynced" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "cursorBefore" TEXT,
    "cursorAfter" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "GmailSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailThread" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "gmailThreadId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "participants" JSONB NOT NULL DEFAULT '[]',
    "labels" JSONB NOT NULL DEFAULT '[]',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "latestMessageAt" TIMESTAMP(3),
    "trackStatus" "GmailThreadTrackStatus" NOT NULL DEFAULT 'UNTRACKED',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "subject" TEXT,
    "from" JSONB NOT NULL DEFAULT '{}',
    "to" JSONB NOT NULL DEFAULT '[]',
    "cc" JSONB NOT NULL DEFAULT '[]',
    "bcc" JSONB NOT NULL DEFAULT '[]',
    "replyTo" JSONB NOT NULL DEFAULT '[]',
    "snippet" TEXT,
    "bodyPlain" TEXT,
    "bodyHtml" TEXT,
    "sentAt" TIMESTAMP(3),
    "internalDate" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "gmailAttachmentId" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "contentId" TEXT,
    "storageRef" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmailAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "status" "InboxEventStatus" NOT NULL DEFAULT 'NEEDS_REPLY',
    "source" "InboxEventSource" NOT NULL,
    "manualImport" BOOLEAN NOT NULL DEFAULT false,
    "extractedFields" JSONB NOT NULL DEFAULT '{}',
    "possibleMatches" JSONB NOT NULL DEFAULT '[]',
    "recommendedNextAction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "InboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxDraft" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "InboxDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "modelMetadata" JSONB NOT NULL DEFAULT '{}',
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxAction" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "draftId" TEXT,
    "messageId" TEXT,
    "actorId" TEXT,
    "actionType" "InboxActionType" NOT NULL,
    "before" JSONB NOT NULL DEFAULT '{}',
    "after" JSONB NOT NULL DEFAULT '{}',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxEvidence" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "draftId" TEXT,
    "kind" "InboxEvidenceKind" NOT NULL,
    "gmailMessageId" TEXT,
    "gmailAttachmentId" TEXT,
    "brainRecordId" TEXT,
    "externalRef" TEXT,
    "locator" TEXT,
    "evidenceText" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GmailConnection_companyId_email_key" ON "GmailConnection"("companyId", "email");

-- CreateIndex
CREATE INDEX "GmailConnection_companyId_status_idx" ON "GmailConnection"("companyId", "status");

-- CreateIndex
CREATE INDEX "GmailSyncRun_companyId_startedAt_idx" ON "GmailSyncRun"("companyId", "startedAt");

-- CreateIndex
CREATE INDEX "GmailSyncRun_connectionId_startedAt_idx" ON "GmailSyncRun"("connectionId", "startedAt");

-- CreateIndex
CREATE INDEX "GmailSyncRun_status_idx" ON "GmailSyncRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GmailThread_companyId_gmailThreadId_key" ON "GmailThread"("companyId", "gmailThreadId");

-- CreateIndex
CREATE INDEX "GmailThread_companyId_latestMessageAt_idx" ON "GmailThread"("companyId", "latestMessageAt");

-- CreateIndex
CREATE INDEX "GmailThread_companyId_trackStatus_idx" ON "GmailThread"("companyId", "trackStatus");

-- CreateIndex
CREATE UNIQUE INDEX "GmailMessage_threadId_gmailMessageId_key" ON "GmailMessage"("threadId", "gmailMessageId");

-- CreateIndex
CREATE INDEX "GmailMessage_threadId_sentAt_idx" ON "GmailMessage"("threadId", "sentAt");

-- CreateIndex
CREATE INDEX "GmailAttachment_messageId_idx" ON "GmailAttachment"("messageId");

-- CreateIndex
CREATE INDEX "GmailAttachment_gmailAttachmentId_idx" ON "GmailAttachment"("gmailAttachmentId");

-- CreateIndex
CREATE UNIQUE INDEX "InboxEvent_threadId_key" ON "InboxEvent"("threadId");

-- CreateIndex
CREATE INDEX "InboxEvent_companyId_status_idx" ON "InboxEvent"("companyId", "status");

-- CreateIndex
CREATE INDEX "InboxEvent_companyId_createdAt_idx" ON "InboxEvent"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "InboxEvent_source_idx" ON "InboxEvent"("source");

-- CreateIndex
CREATE INDEX "InboxDraft_eventId_status_idx" ON "InboxDraft"("eventId", "status");

-- CreateIndex
CREATE INDEX "InboxAction_eventId_createdAt_idx" ON "InboxAction"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "InboxAction_draftId_idx" ON "InboxAction"("draftId");

-- CreateIndex
CREATE INDEX "InboxAction_messageId_idx" ON "InboxAction"("messageId");

-- CreateIndex
CREATE INDEX "InboxAction_actorId_idx" ON "InboxAction"("actorId");

-- CreateIndex
CREATE INDEX "InboxAction_actionType_idx" ON "InboxAction"("actionType");

-- CreateIndex
CREATE INDEX "InboxEvidence_eventId_kind_idx" ON "InboxEvidence"("eventId", "kind");

-- CreateIndex
CREATE INDEX "InboxEvidence_draftId_idx" ON "InboxEvidence"("draftId");

-- CreateIndex
CREATE INDEX "InboxEvidence_gmailMessageId_idx" ON "InboxEvidence"("gmailMessageId");

-- CreateIndex
CREATE INDEX "InboxEvidence_gmailAttachmentId_idx" ON "InboxEvidence"("gmailAttachmentId");

-- CreateIndex
CREATE INDEX "InboxEvidence_brainRecordId_idx" ON "InboxEvidence"("brainRecordId");

-- AddForeignKey
ALTER TABLE "GmailConnection" ADD CONSTRAINT "GmailConnection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailSyncRun" ADD CONSTRAINT "GmailSyncRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailSyncRun" ADD CONSTRAINT "GmailSyncRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GmailConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailThread" ADD CONSTRAINT "GmailThread_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailMessage" ADD CONSTRAINT "GmailMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "GmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailAttachment" ADD CONSTRAINT "GmailAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "GmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxEvent" ADD CONSTRAINT "InboxEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxEvent" ADD CONSTRAINT "InboxEvent_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "GmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxDraft" ADD CONSTRAINT "InboxDraft_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "InboxEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxDraft" ADD CONSTRAINT "InboxDraft_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxDraft" ADD CONSTRAINT "InboxDraft_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxAction" ADD CONSTRAINT "InboxAction_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "InboxEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxAction" ADD CONSTRAINT "InboxAction_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "InboxDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxAction" ADD CONSTRAINT "InboxAction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "GmailMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxAction" ADD CONSTRAINT "InboxAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxEvidence" ADD CONSTRAINT "InboxEvidence_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "InboxEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxEvidence" ADD CONSTRAINT "InboxEvidence_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "InboxDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxEvidence" ADD CONSTRAINT "InboxEvidence_gmailMessageId_fkey" FOREIGN KEY ("gmailMessageId") REFERENCES "GmailMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxEvidence" ADD CONSTRAINT "InboxEvidence_gmailAttachmentId_fkey" FOREIGN KEY ("gmailAttachmentId") REFERENCES "GmailAttachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxEvidence" ADD CONSTRAINT "InboxEvidence_brainRecordId_fkey" FOREIGN KEY ("brainRecordId") REFERENCES "BrainRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
