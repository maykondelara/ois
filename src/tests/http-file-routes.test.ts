import { describe, expect, it, vi } from "vitest";

const context = {
  actorUserId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "MANAGER" as const,
  permissions: new Set(["documents.manage", "documents.file.read"]),
};
const provider = {};
const initiateStoredFile = vi.fn();
const finalizeStoredFile = vi.fn();
const createStoredFileDownload = vi.fn();

vi.mock("@/auth/context", () => ({ requireTenantContext: vi.fn(async () => context) }));
vi.mock("@/db/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/documents/r2-file-storage.provider", () => ({
  getFileStorageProvider: () => ({
    provider,
    bucket: "private-bucket",
    uploadUrlTtlSeconds: 900,
    downloadUrlTtlSeconds: 300,
  }),
}));
vi.mock("@/modules/documents/stored-file.service", () => ({
  initiateStoredFile,
  finalizeStoredFile,
  createStoredFileDownload,
}));

const initiateRoute = await import("@/app/api/companies/[companyId]/files/route");
const finalizeRoute = await import("@/app/api/companies/[companyId]/files/[fileId]/finalize/route");
const downloadRoute = await import("@/app/api/companies/[companyId]/files/[fileId]/download/route");
const params = Promise.resolve({ companyId: context.companyId });
const fileParams = Promise.resolve({
  companyId: context.companyId,
  fileId: "44444444-4444-4444-8444-444444444444",
});

describe("private file HTTP transport", () => {
  it("returns only the authorized upload transport fields", async () => {
    initiateStoredFile.mockResolvedValueOnce({
      file: { id: "44444444-4444-4444-8444-444444444444", bucket: "private", objectKey: "opaque" },
      uploadUrl: "https://signed.test/put?signature=secret",
    });
    const response = await initiateRoute.POST(
      new Request(`https://ois.test/api/companies/${context.companyId}/files`, {
        method: "POST",
        headers: { origin: "https://ois.test", "content-type": "application/json" },
        body: JSON.stringify({ originalFilename: "evidence.pdf" }),
      }),
      { params },
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data).toMatchObject({ uploadUrl: expect.any(String), expiresInSeconds: 900 });
    expect(JSON.stringify(body.data)).not.toMatch(/bucket|objectKey|provider/i);
  });

  it("maps finalize and download through the provider-neutral service contract", async () => {
    finalizeStoredFile.mockResolvedValueOnce({
      id: "file-id",
      fileState: "AVAILABLE",
      mimeType: "application/pdf",
      sizeBytes: 8,
    });
    createStoredFileDownload.mockResolvedValueOnce({
      filename: "evidence.pdf",
      url: "https://signed.test/get?signature=secret",
    });
    const finalize = await finalizeRoute.POST(
      new Request(`https://ois.test/api/companies/${context.companyId}/files/file/finalize`, {
        method: "POST",
        headers: { origin: "https://ois.test", "content-type": "application/json" },
        body: "{}",
      }),
      { params: fileParams },
    );
    expect(finalize.status).toBe(200);
    expect(JSON.stringify(await finalize.json())).not.toMatch(/bucket|objectKey|provider/i);
    const download = await downloadRoute.GET(
      new Request(`https://ois.test/api/companies/${context.companyId}/files/file/download`),
      { params: fileParams },
    );
    expect(download.status).toBe(200);
    expect((await download.json()).data).toMatchObject({ downloadUrl: expect.any(String) });
    expect(initiateStoredFile).toHaveBeenCalledWith(
      {},
      context,
      provider,
      "private-bucket",
      "evidence.pdf",
      900,
    );
  });
});
