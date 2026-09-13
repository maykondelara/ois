import type { FileStorageRuntime } from "../src/modules/documents/r2-file-storage.provider";

const objects = new Map<string, Uint8Array>();
const key = (bucket: string, objectKey: string) => `${bucket}:${objectKey}`;
const provider: FileStorageRuntime["provider"] = {
  async createUploadUrl({ bucket, objectKey }) {
    objects.set(key(bucket, objectKey), new TextEncoder().encode("%PDF-1.7\nacceptance"));
    return "https://acceptance.invalid/upload?redacted";
  },
  async inspectObject({ bucket, objectKey }) {
    const content = objects.get(key(bucket, objectKey));
    if (!content) throw new Error("Acceptance object is missing");
    return { content };
  },
  async createDownloadUrl() {
    return "https://acceptance.invalid/download?redacted";
  },
};
(globalThis as typeof globalThis & { [key: symbol]: FileStorageRuntime })[
  Symbol.for("ois.file-storage.acceptance-runtime")
] = {
  provider,
  bucket: "acceptance-private",
  uploadUrlTtlSeconds: 900,
  downloadUrlTtlSeconds: 300,
};
