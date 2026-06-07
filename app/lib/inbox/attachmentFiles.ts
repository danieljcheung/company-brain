import { createHash } from "crypto";
import { downloadArtifactFromR2, uploadArtifactToR2 } from "@/app/lib/r2";

const attachmentPrefix = "r2://inbox-attachments/";

export function hashAttachmentBytes(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildLocalAttachmentStorageRef(input: {
  hash: string;
  filename: string;
}) {
  return `${attachmentPrefix}${input.hash}-${sanitizeFilename(input.filename)}`;
}

export function isLocalAttachmentStorageRef(value: string | null | undefined) {
  return Boolean(value?.startsWith(attachmentPrefix));
}

export async function writeLocalAttachment(input: {
  storageRef: string;
  bytes: Buffer;
}) {
  const objectKey = attachmentObjectKey(input.storageRef);
  await uploadArtifactToR2({ objectKey, body: input.bytes });
}

export async function readLocalAttachment(storageRef: string) {
  return downloadArtifactFromR2(attachmentObjectKey(storageRef));
}
 
function attachmentObjectKey(storageRef: string) {
  if (!storageRef.startsWith(attachmentPrefix)) {
    throw new Error("Unsupported attachment storage reference.");
  }

  const relative = storageRef.slice(attachmentPrefix.length);
  if (relative.includes("..") || relative.includes("/") || relative.includes("\\")) {
    throw new Error("Invalid attachment storage reference.");
  }

  return `companies/popuppearl/inbox-attachments/${relative}`;
}


function sanitizeFilename(filename: string) {
  return (
    filename
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "attachment.bin"
  );
}
