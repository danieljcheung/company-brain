-- Preserve Gmail attachment row identity by enforcing one Gmail attachment id per stored message.
WITH duplicate_attachments AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY "messageId", "gmailAttachmentId"
      ORDER BY "createdAt", id
    ) AS keep_id
  FROM "GmailAttachment"
  WHERE "gmailAttachmentId" IS NOT NULL
)
UPDATE "InboxEvidence" evidence
SET "gmailAttachmentId" = duplicate_attachments.keep_id
FROM duplicate_attachments
WHERE evidence."gmailAttachmentId" = duplicate_attachments.id
  AND duplicate_attachments.id <> duplicate_attachments.keep_id;

WITH duplicate_attachments AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY "messageId", "gmailAttachmentId"
      ORDER BY "createdAt", id
    ) AS keep_id
  FROM "GmailAttachment"
  WHERE "gmailAttachmentId" IS NOT NULL
)
DELETE FROM "GmailAttachment" attachment
USING duplicate_attachments
WHERE attachment.id = duplicate_attachments.id
  AND duplicate_attachments.id <> duplicate_attachments.keep_id;

CREATE UNIQUE INDEX "GmailAttachment_messageId_gmailAttachmentId_key" ON "GmailAttachment"("messageId", "gmailAttachmentId");
