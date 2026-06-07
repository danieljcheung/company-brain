export type AttachmentLifecycleStatus =
  | "metadata_only"
  | "downloaded"
  | "failed";

export function attachmentMetadataObject(value: unknown) {
  return isRecord(value) ? { ...value } : {};
}

export function attachmentLifecycleStatus(value: unknown): AttachmentLifecycleStatus {
  const metadata = attachmentMetadataObject(value);
  const status = metadata.lifecycleStatus;
  if (
    status === "metadata_only" ||
    status === "downloaded" ||
    status === "failed"
  ) {
    return status;
  }
  return "metadata_only";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
