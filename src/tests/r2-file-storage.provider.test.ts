import { describe, expect, it } from "vitest";
import {
  getFileStorageProvider,
  loadR2StorageConfig,
  R2FileStorageProvider,
} from "@/modules/documents/r2-file-storage.provider";

const validEnv: Record<string, string | undefined> = {
  FILE_STORAGE_PROVIDER: "r2",
  R2_ACCOUNT_ID: "account-id",
  R2_ACCESS_KEY_ID: "access-key",
  R2_SECRET_ACCESS_KEY: "secret-key",
  R2_BUCKET: "private-bucket",
};

describe("Cloudflare R2 file storage configuration", () => {
  it("accepts required R2 configuration and secure TTL defaults", () => {
    expect(loadR2StorageConfig(validEnv)).toMatchObject({
      bucket: "private-bucket",
      region: "auto",
      uploadUrlTtlSeconds: 900,
      downloadUrlTtlSeconds: 300,
    });
    expect(getFileStorageProvider(validEnv)).toMatchObject({
      bucket: "private-bucket",
      uploadUrlTtlSeconds: 900,
      downloadUrlTtlSeconds: 300,
    });
  });

  it.each(["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"])(
    "rejects missing %s",
    (name) => {
      const env = { ...validEnv };
      delete env[name];
      expect(() => loadR2StorageConfig(env)).toThrow(name);
    },
  );

  it("rejects unsupported provider and invalid TTL values", () => {
    expect(() => loadR2StorageConfig({ ...validEnv, FILE_STORAGE_PROVIDER: "memory" })).toThrow(
      "FILE_STORAGE_PROVIDER",
    );
    expect(() => loadR2StorageConfig({ ...validEnv, FILE_UPLOAD_URL_TTL_SECONDS: "0" })).toThrow(
      "FILE_UPLOAD_URL_TTL_SECONDS",
    );
  });

  it("bounds streamed inspection and turns missing objects into a safe not-found domain error", async () => {
    const chunks = [new TextEncoder().encode("%PDF-1.7")];
    const client = {
      send: async (command: { constructor: { name: string } }) =>
        command.constructor.name === "HeadObjectCommand"
          ? { ContentLength: 8 }
          : {
              Body: (async function* () {
                yield chunks[0];
              })(),
            },
    };
    const provider = new R2FileStorageProvider(client as never, async () => "https://signed.test");
    await expect(
      provider.inspectObject({ bucket: "private", objectKey: "opaque", maxBytes: 10 }),
    ).resolves.toEqual({
      content: chunks[0],
    });
    const missing = new R2FileStorageProvider(
      { send: async () => Promise.reject({ name: "NoSuchKey" }) } as never,
      async () => "https://signed.test",
    );
    await expect(
      missing.inspectObject({ bucket: "private", objectKey: "opaque" }),
    ).rejects.toMatchObject({
      code: "TENANT_RECORD_NOT_FOUND",
    });
  });
});
