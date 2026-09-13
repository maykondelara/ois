/* eslint-disable no-unused-vars */
import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/modules/identity/tenant-context";
import { finalizeStoredFile, quarantineStoredFile } from "@/modules/documents/stored-file.service";

const context: TenantContext = {
  actorUserId: "manager-a",
  companyId: "company-a",
  membershipId: "membership-a",
  role: "MANAGER",
  permissions: new Set(["documents.manage"]),
};

function finalizeClient() {
  const updates: Array<Record<string, unknown>> = [];
  const transaction = {
    $executeRaw: async () => 1,
    storedFile: {
      findUnique: async () => ({
        id: "file-a",
        companyId: "company-a",
        bucket: "private",
        objectKey: "opaque",
        fileState: "PENDING",
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => (updates.push(data), data),
    },
    activity: { create: async ({ data }: { data: unknown }) => data },
  };
  return {
    updates,
    client: {
      $transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
        callback(transaction),
    },
  };
}

describe("stored file finalization", () => {
  it("trusts actual bytes and quarantines an invalid claimed upload", async () => {
    const fake = finalizeClient();
    await finalizeStoredFile(
      fake.client as never,
      context,
      { inspectObject: async () => ({ content: new Uint8Array([1, 2, 3]) }) } as never,
      "file-a",
    );
    expect(fake.updates).toEqual([{ fileState: "QUARANTINED" }]);
  });

  it("persists verified PDF metadata from storage bytes", async () => {
    const fake = finalizeClient();
    await finalizeStoredFile(
      fake.client as never,
      context,
      {
        inspectObject: async () => ({ content: new TextEncoder().encode("%PDF-1.7") }),
      } as never,
      "file-a",
    );
    expect(fake.updates[0]).toMatchObject({
      fileState: "AVAILABLE",
      mimeType: "application/pdf",
      sizeBytes: 8,
    });
  });

  it("quarantines an AVAILABLE file without changing verified physical metadata", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const transaction = {
      $executeRaw: async () => 1,
      storedFile: {
        findUnique: async () => ({ id: "file-a", fileState: "AVAILABLE" }),
        update: async ({ data }: { data: Record<string, unknown> }) => (updates.push(data), data),
      },
      activity: { create: async ({ data }: { data: unknown }) => data },
    };
    const client = {
      $transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
        callback(transaction),
    };
    await quarantineStoredFile(client as never, context, "file-a");
    expect(updates).toEqual([{ fileState: "QUARANTINED" }]);
  });
});
