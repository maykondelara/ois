import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomBytes } from "node:crypto";
import {
  getFileStorageProvider,
  loadR2StorageConfig,
} from "../src/modules/documents/r2-file-storage.provider";

function configured() {
  return [
    "FILE_STORAGE_PROVIDER",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
  ].every((name) => Boolean(process.env[name]?.trim()));
}

async function main() {
  if (!configured()) {
    console.log("r2_real_smoke: SKIP (R2 credentials are not configured)");
    return;
  }
  const config = loadR2StorageConfig();
  const runtime = getFileStorageProvider();
  const key = `smoke/${randomBytes(16).toString("hex")}`;
  const content = new TextEncoder().encode("%PDF-1.7\nR2 smoke");
  const client = new S3Client({
    region: config.region,
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  try {
    const uploadUrl = await runtime.provider.createUploadUrl({
      bucket: runtime.bucket,
      objectKey: key,
      expiresInSeconds: runtime.uploadUrlTtlSeconds,
    });
    if (!uploadUrl) throw new Error("Presigned upload URL was not created");
    await client.send(new PutObjectCommand({ Bucket: runtime.bucket, Key: key, Body: content }));
    const inspected = await runtime.provider.inspectObject({
      bucket: runtime.bucket,
      objectKey: key,
      maxBytes: 10_485_760,
    });
    if (inspected.content.byteLength !== content.byteLength)
      throw new Error("Object verification failed");
    const downloadUrl = await runtime.provider.createDownloadUrl({
      bucket: runtime.bucket,
      objectKey: key,
      expiresInSeconds: runtime.downloadUrlTtlSeconds,
    });
    if (!downloadUrl) throw new Error("Presigned download URL was not created");
    const response = await fetch(downloadUrl);
    if (!response.ok || (await response.arrayBuffer()).byteLength !== content.byteLength)
      throw new Error("Presigned download verification failed");
    console.log("r2_real_smoke: PASS");
  } finally {
    await client
      .send(new DeleteObjectCommand({ Bucket: runtime.bucket, Key: key }))
      .catch(() => undefined);
  }
}

main().catch(() => {
  console.error("r2_real_smoke: FAIL");
  process.exitCode = 1;
});
