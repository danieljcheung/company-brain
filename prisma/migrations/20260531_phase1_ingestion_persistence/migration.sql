-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'REVIEWER', 'VIEWER');

-- CreateEnum
CREATE TYPE "BrainSourceType" AS ENUM ('TEXT', 'MARKDOWN', 'CSV', 'PDF', 'IMAGE', 'EMAIL_EXPORT', 'SHEET_INSPECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "BrainCandidateKind" AS ENUM ('ENTITY', 'FACT', 'RULE', 'OPEN_QUESTION', 'RELATIONSHIP');

-- CreateEnum
CREATE TYPE "BrainSection" AS ENUM ('COMPANY_PROFILE', 'PEOPLE_ROLES', 'CUSTOMERS', 'VENDORS', 'PRODUCTS_MENU', 'PRICING_RULES', 'EXPENSE_CATEGORIES', 'RECEIPT_RULES', 'REIMBURSEMENT_RULES', 'SHEET_MAPPINGS', 'WORKFLOWS', 'APPROVAL_RULES', 'OPEN_QUESTIONS', 'SOURCE_LIBRARY');

-- CreateEnum
CREATE TYPE "BrainReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'NEEDS_CLARIFICATION', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "BrainReviewAction" AS ENUM ('CREATED', 'APPROVED', 'REJECTED', 'EDITED', 'NEEDS_CLARIFICATION', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'REVIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainSource" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceType" "BrainSourceType" NOT NULL,
    "contentHash" TEXT NOT NULL,
    "storageRef" TEXT,
    "rawText" TEXT NOT NULL,
    "extractedText" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrainSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainCandidate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "BrainCandidateKind" NOT NULL,
    "section" "BrainSection" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "structuredData" JSONB NOT NULL DEFAULT '{}',
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "BrainReviewStatus" NOT NULL DEFAULT 'PENDING',
    "extractedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "approvedRecordId" TEXT,

    CONSTRAINT "BrainCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainCandidateSource" (
    "candidateId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "locator" TEXT,
    "evidence" TEXT NOT NULL,

    CONSTRAINT "BrainCandidateSource_pkey" PRIMARY KEY ("candidateId","sourceId","evidence")
);

-- CreateTable
CREATE TABLE "BrainRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "section" "BrainSection" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "structuredData" JSONB NOT NULL DEFAULT '{}',
    "status" "BrainReviewStatus" NOT NULL DEFAULT 'APPROVED',
    "reviewerId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrainRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainRecordSource" (
    "recordId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "locator" TEXT,
    "evidence" TEXT NOT NULL,

    CONSTRAINT "BrainRecordSource_pkey" PRIMARY KEY ("recordId","sourceId","evidence")
);

-- CreateTable
CREATE TABLE "BrainReviewEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "candidateId" TEXT,
    "recordId" TEXT,
    "actorId" TEXT,
    "action" "BrainReviewAction" NOT NULL,
    "fromStatus" "BrainReviewStatus",
    "toStatus" "BrainReviewStatus",
    "note" TEXT,
    "before" JSONB NOT NULL DEFAULT '{}',
    "after" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrainReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainQuestion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "candidateId" TEXT,
    "recordId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "BrainReviewStatus" NOT NULL DEFAULT 'NEEDS_CLARIFICATION',
    "answer" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrainQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainQuestionSource" (
    "questionId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "locator" TEXT,
    "evidence" TEXT NOT NULL,

    CONSTRAINT "BrainQuestionSource_pkey" PRIMARY KEY ("questionId","sourceId","evidence")
);

-- CreateTable
CREATE TABLE "BrainVersion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrainVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainVersionSource" (
    "versionId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "locator" TEXT,
    "evidence" TEXT NOT NULL,

    CONSTRAINT "BrainVersionSource_pkey" PRIMARY KEY ("versionId","sourceId","evidence")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_companyId_email_key" ON "User"("companyId", "email");

-- CreateIndex
CREATE INDEX "BrainSource_companyId_sourceType_idx" ON "BrainSource"("companyId", "sourceType");

-- CreateIndex
CREATE INDEX "BrainSource_companyId_importedAt_idx" ON "BrainSource"("companyId", "importedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrainSource_companyId_contentHash_key" ON "BrainSource"("companyId", "contentHash");

-- CreateIndex
CREATE INDEX "BrainCandidate_companyId_status_idx" ON "BrainCandidate"("companyId", "status");

-- CreateIndex
CREATE INDEX "BrainCandidate_companyId_section_idx" ON "BrainCandidate"("companyId", "section");

-- CreateIndex
CREATE INDEX "BrainRecord_companyId_status_idx" ON "BrainRecord"("companyId", "status");

-- CreateIndex
CREATE INDEX "BrainRecord_companyId_section_idx" ON "BrainRecord"("companyId", "section");

-- CreateIndex
CREATE INDEX "BrainReviewEvent_companyId_createdAt_idx" ON "BrainReviewEvent"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "BrainReviewEvent_candidateId_idx" ON "BrainReviewEvent"("candidateId");

-- CreateIndex
CREATE INDEX "BrainReviewEvent_recordId_idx" ON "BrainReviewEvent"("recordId");

-- CreateIndex
CREATE UNIQUE INDEX "BrainQuestion_candidateId_key" ON "BrainQuestion"("candidateId");

-- CreateIndex
CREATE INDEX "BrainQuestion_companyId_status_idx" ON "BrainQuestion"("companyId", "status");

-- CreateIndex
CREATE INDEX "BrainVersion_companyId_createdAt_idx" ON "BrainVersion"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrainVersion_recordId_version_key" ON "BrainVersion"("recordId", "version");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainSource" ADD CONSTRAINT "BrainSource_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainCandidate" ADD CONSTRAINT "BrainCandidate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainCandidate" ADD CONSTRAINT "BrainCandidate_approvedRecordId_fkey" FOREIGN KEY ("approvedRecordId") REFERENCES "BrainRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainCandidateSource" ADD CONSTRAINT "BrainCandidateSource_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "BrainCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainCandidateSource" ADD CONSTRAINT "BrainCandidateSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "BrainSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainRecord" ADD CONSTRAINT "BrainRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainRecord" ADD CONSTRAINT "BrainRecord_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainRecord" ADD CONSTRAINT "BrainRecord_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "BrainRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainRecordSource" ADD CONSTRAINT "BrainRecordSource_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "BrainRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainRecordSource" ADD CONSTRAINT "BrainRecordSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "BrainSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainReviewEvent" ADD CONSTRAINT "BrainReviewEvent_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "BrainCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainReviewEvent" ADD CONSTRAINT "BrainReviewEvent_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "BrainRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainReviewEvent" ADD CONSTRAINT "BrainReviewEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainQuestion" ADD CONSTRAINT "BrainQuestion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainQuestion" ADD CONSTRAINT "BrainQuestion_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "BrainCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainQuestion" ADD CONSTRAINT "BrainQuestion_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "BrainRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainQuestionSource" ADD CONSTRAINT "BrainQuestionSource_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "BrainQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainQuestionSource" ADD CONSTRAINT "BrainQuestionSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "BrainSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainVersion" ADD CONSTRAINT "BrainVersion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainVersion" ADD CONSTRAINT "BrainVersion_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "BrainRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainVersion" ADD CONSTRAINT "BrainVersion_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainVersionSource" ADD CONSTRAINT "BrainVersionSource_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "BrainVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainVersionSource" ADD CONSTRAINT "BrainVersionSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "BrainSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

