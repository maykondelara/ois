/* eslint-disable no-unused-vars */
import { describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/errors";
import {
  attachDocumentFile,
  attachDriverLicenceFile,
} from "@/modules/documents/file-association.service";
import { createStoredFileDownload } from "@/modules/documents/stored-file.service";
import type { TenantContext } from "@/modules/identity/tenant-context";

const selfContext: TenantContext = {
  actorUserId: "driver-user-a",
  companyId: "company-a",
  membershipId: "membership-a",
  role: "DRIVER",
  permissions: new Set(["documents.read", "documents.file.read"]),
};

function clientForDriver(driverUserId: string | null, hasDocumentAttachment = false) {
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [],
    document: {
      findUnique: async () => ({
        id: "document-a",
        companyId: "company-a",
        subjectType: "DRIVER",
        driverId: "driver-a",
        reviewStatus: "PENDING_REVIEW",
        archivedAt: null,
        revokedAt: null,
      }),
    },
    driver: {
      findUnique: async () => ({ companyId: "company-a", userId: driverUserId }),
    },
    storedFile: {
      findUnique: async () => ({
        id: "file-a",
        companyId: "company-a",
        fileState: "AVAILABLE",
        mimeType: "application/pdf",
        originalFilename: "own.pdf",
        bucket: "private",
        objectKey: "opaque",
      }),
    },
    documentFile: {
      findFirst: async () => (hasDocumentAttachment ? { documentId: "document-a" } : null),
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: "document-file-a",
        ...data,
      }),
    },
    driverLicence: {
      findUnique: async () => ({ id: "licence-a", companyId: "company-a", driverId: "driver-a" }),
    },
    driverLicenceFile: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: "licence-file-a",
        ...data,
      }),
    },
    activity: { create: async ({ data }: { data: unknown }) => data },
  };
  return {
    client: {
      $transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
        callback(transaction),
    },
  };
}

describe("DRIVER file record scope", () => {
  it("allows own document-file attachment, licence-file attachment, and file download", async () => {
    const { client: documentClient } = clientForDriver("driver-user-a");

    await expect(
      attachDocumentFile(documentClient as never, selfContext, "document-a", "file-a"),
    ).resolves.toMatchObject({ id: "document-file-a" });
    const { client: licenceClient } = clientForDriver("driver-user-a");
    await expect(
      attachDriverLicenceFile(
        licenceClient as never,
        selfContext,
        "licence-a",
        "file-a",
        "COMBINED",
      ),
    ).resolves.toMatchObject({ id: "licence-file-a" });
    const { client: downloadClient } = clientForDriver("driver-user-a", true);
    await expect(
      createStoredFileDownload(
        downloadClient as never,
        selfContext,
        { createDownloadUrl: async () => "memory://own-file" } as never,
        "file-a",
      ),
    ).resolves.toMatchObject({ filename: "own.pdf", url: "memory://own-file" });
  });

  it("still denies attachment to another DRIVER's evidence", async () => {
    const { client } = clientForDriver("driver-user-b");

    await expect(
      attachDocumentFile(client as never, selfContext, "document-a", "file-a"),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      attachDriverLicenceFile(client as never, selfContext, "licence-a", "file-a", "COMBINED"),
    ).rejects.toBeInstanceOf(AuthorizationError);
    const { client: downloadClient } = clientForDriver("driver-user-b", true);
    await expect(
      createStoredFileDownload(
        downloadClient as never,
        selfContext,
        { createDownloadUrl: async () => "memory://other-file" } as never,
        "file-a",
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
