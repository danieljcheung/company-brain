export type InboxAttachmentVisibilityInput = {
  filename: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  contentId?: string | null;
};

export function isVisibleInboxAttachment(input: InboxAttachmentVisibilityInput) {
  if (isInlineImage(input)) return false;
  if (isLikelyFooterImage(input)) return false;
  return true;
}

function isInlineImage(input: InboxAttachmentVisibilityInput) {
  return Boolean(input.contentId) && isImage(input);
}

function isLikelyFooterImage(input: InboxAttachmentVisibilityInput) {
  const filename = input.filename.toLowerCase();
  const genericInlineName = /^image\d{3}\.(?:png|jpe?g|gif|webp)$/.test(filename);
  const smallish = typeof input.sizeBytes === "number" && input.sizeBytes > 0 && input.sizeBytes <= 150_000;
  return isImage(input) && genericInlineName && smallish;
}

function isImage(input: InboxAttachmentVisibilityInput) {
  return input.mimeType?.toLowerCase().startsWith("image/") ?? false;
}
