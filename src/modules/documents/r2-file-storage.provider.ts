import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { TenantRecordNotFoundError } from "@/lib/errors";
import type { FileStorageProvider } from "@/modules/documents/file-storage";

export type R2StorageConfig = Readonly<{
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
  uploadUrlTtlSeconds: number;
  downloadUrlTtlSeconds: number;
}>;

export type FileStorageRuntime = Readonly<{
  provider: FileStorageProvider;
  bucket: string;
  uploadUrlTtlSeconds: number;
  downloadUrlTtlSeconds: number;
}>;

const acceptanceStorageSymbol = Symbol.for("ois.file-storage.acceptance-runtime");

type Environment = Readonly<Record<string, string | undefined>>;

const uploadDefaultSeconds = 900;
const downloadDefaultSeconds = 300;
const maxTtlSeconds = 3_600;

function required(env: Environment, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`File storage configuration is missing ${name}`);
  return value;
}

function ttl(env: Environment, name: string, fallback: number) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > maxTtlSeconds)
    throw new Error(`File storage configuration has invalid ${name}`);
  return value;
}

export function loadR2StorageConfig(env: Environment = process.env): R2StorageConfig {
  if (env.FILE_STORAGE_PROVIDER !== "r2")
    throw new Error("File storage configuration has unsupported FILE_STORAGE_PROVIDER");
  return {
    accountId: required(env, "R2_ACCOUNT_ID"),
    accessKeyId: required(env, "R2_ACCESS_KEY_ID"),
    secretAccessKey: required(env, "R2_SECRET_ACCESS_KEY"),
    bucket: required(env, "R2_BUCKET"),
    region: env.R2_REGION?.trim() || "auto",
    uploadUrlTtlSeconds: ttl(env, "FILE_UPLOAD_URL_TTL_SECONDS", uploadDefaultSeconds),
    downloadUrlTtlSeconds: ttl(env, "FILE_DOWNLOAD_URL_TTL_SECONDS", downloadDefaultSeconds),
  };
}

function isNotFound(error: unknown) {
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate?.$metadata?.httpStatusCode === 404 || candidate?.name === "NoSuchKey";
}

async function readBoundedBody(output: GetObjectCommandOutput, maxBytes: number) {
  const body = output.Body;
  if (!body) throw new TenantRecordNotFoundError("Storage object");
  if (typeof output.ContentLength === "number" && output.ContentLength > maxBytes)
    return new Uint8Array(maxBytes + 1);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > maxBytes) return new Uint8Array(maxBytes + 1);
    chunks.push(chunk);
  }
  const content = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return content;
}

/** Cloudflare R2's S3-compatible private-object implementation. */
export class R2FileStorageProvider implements FileStorageProvider {
  private readonly client: S3Client;
  private readonly sign: typeof getSignedUrl;

  constructor(client: S3Client, sign = getSignedUrl) {
    this.client = client;
    this.sign = sign;
  }

  async createUploadUrl(input: { bucket: string; objectKey: string; expiresInSeconds: number }) {
    return this.sign(
      this.client,
      new PutObjectCommand({ Bucket: input.bucket, Key: input.objectKey }),
      { expiresIn: input.expiresInSeconds },
    );
  }

  async inspectObject(input: { bucket: string; objectKey: string; maxBytes?: number }) {
    const maxBytes = input.maxBytes ?? 10_485_760;
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: input.bucket, Key: input.objectKey }),
      );
      if (typeof head.ContentLength === "number" && head.ContentLength > maxBytes)
        return { content: new Uint8Array(maxBytes + 1) };
      return {
        content: await readBoundedBody(
          await this.client.send(
            new GetObjectCommand({ Bucket: input.bucket, Key: input.objectKey }),
          ),
          maxBytes,
        ),
      };
    } catch (error) {
      if (isNotFound(error)) throw new TenantRecordNotFoundError("Storage object");
      throw error;
    }
  }

  async createDownloadUrl(input: { bucket: string; objectKey: string; expiresInSeconds: number }) {
    return this.sign(
      this.client,
      new GetObjectCommand({
        Bucket: input.bucket,
        Key: input.objectKey,
        ResponseContentDisposition: "attachment",
      }),
      { expiresIn: input.expiresInSeconds },
    );
  }
}

export function getFileStorageProvider(env: Environment = process.env): FileStorageRuntime {
  const acceptanceRuntime = (
    globalThis as typeof globalThis & { [acceptanceStorageSymbol]?: FileStorageRuntime }
  )[acceptanceStorageSymbol];
  if (env.OIS_FILE_STORAGE_ACCEPTANCE_FAKE === "true" && acceptanceRuntime)
    return acceptanceRuntime;
  const config = loadR2StorageConfig(env);
  const client = new S3Client({
    region: config.region,
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return {
    provider: new R2FileStorageProvider(client),
    bucket: config.bucket,
    uploadUrlTtlSeconds: config.uploadUrlTtlSeconds,
    downloadUrlTtlSeconds: config.downloadUrlTtlSeconds,
  };
}
