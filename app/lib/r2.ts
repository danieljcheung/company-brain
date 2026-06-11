import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

type R2Config = {
  accountId: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
};

function readR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const endpoint = process.env.R2_ENDPOINT?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucketName = process.env.R2_BUCKET_NAME?.trim();

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    return null;
  }

  const resolvedEndpoint = endpoint || `https://${accountId}.r2.cloudflarestorage.com`;
  return {
    accountId,
    endpoint: resolvedEndpoint,
    accessKeyId,
    secretAccessKey,
    bucketName,
  };
}

export function hasR2Config() {
  return Boolean(readR2Config());
}

let s3Client: S3Client | null = null;

function getS3Client(config: R2Config) {
  if (s3Client) return s3Client;
  s3Client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return s3Client;
}

export function sanitizeFilename(filename: string) {
  const clean = filename
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return clean || "artifact.bin";
}

export function buildSourceObjectKey(input: {
  hash: string;
  filename: string;
  date?: Date;
}) {
  const date = input.date ?? new Date();
  const year = date.getUTCFullYear().toString();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const safeName = sanitizeFilename(input.filename);
  return `companies/popuppearl/sources/${year}/${month}/${input.hash}-${safeName}`;
}

export async function uploadArtifactToR2(input: {
  objectKey: string;
  body: Buffer;
  contentType?: string;
}) {
  const config = readR2Config();
  if (!config) {
    throw new Error(
      "R2 config is missing. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.",
    );
  }

  const client = getS3Client(config);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucketName,
      Key: input.objectKey,
      Body: input.body,
      ContentType: input.contentType || "application/octet-stream",
    }),
  );

  return { storageRef: input.objectKey };
}

export async function downloadArtifactFromR2(objectKey: string) {
  const config = readR2Config();
  if (!config) {
    throw new Error(
      "R2 config is missing. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.",
    );
  }

  const client = getS3Client(config);
  const response = await client.send(
    new GetObjectCommand({
      Bucket: config.bucketName,
      Key: objectKey,
    }),
  );

  if (!response.Body) {
    throw new Error("R2 object response did not include a body.");
  }

  return Buffer.from(await response.Body.transformToByteArray());
}
