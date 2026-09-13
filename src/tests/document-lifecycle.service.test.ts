/* eslint-disable no-unused-vars */
import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/modules/identity/tenant-context";
import { reviewDocument } from "@/modules/documents/document-review.service";
import { updatePendingDocument } from "@/modules/documents/document.service";

const manager: TenantContext = {
  actorUserId: "reviewer-a",
  companyId: "company-a",
  membershipId: "membership-a",
  role: "MANAGER",
  permissions: new Set(["documents.manage", "documents.review"]),
};

function clientFor(document: Record<string, unknown>, activeFile = true) {
  const audits: Array<Record<string, unknown>> = [];
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [],
    document: {
      findUnique: async () => document,
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...document, ...data }),
    },
    documentType: {
      findUnique: async () => ({
        id: "type-a",
        evidenceSourceType: "DOCUMENT",
        requiresIssueDate: false,
        requiresExpiryDate: false,
      }),
      findFirst: async () => ({
        id: "type-a",
        requiresIssueDate: false,
        requiresExpiryDate: false,
      }),
    },
    documentFile: { findMany: async () => (activeFile ? [{ storedFileId: "file-a" }] : []) },
    storedFile: { findFirst: async () => (activeFile ? { id: "file-a" } : null) },
    documentReviewHistory: { create: async ({ data }: { data: unknown }) => data },
    driver: { findUnique: async () => null },
    activity: {
      create: async ({ data }: { data: Record<string, unknown> }) => (audits.push(data), data),
    },
  };
  return {
    audits,
    client: {
      $transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
        callback(transaction),
    },
  };
}

describe("document lifecycle service", () => {
  it("requires four-eyes and an available file for approval", async () => {
    const pending = {
      id: "document-a",
      companyId: "company-a",
      documentTypeId: "type-a",
      subjectType: "COMPANY",
      createdByUserId: "creator-a",
      reviewStatus: "PENDING_REVIEW",
      archivedAt: null,
      revokedAt: null,
      issueDate: null,
      validFrom: null,
      expiryDate: null,
    };
    const fake = clientFor(pending);
    const approved = await reviewDocument(fake.client as never, manager, "document-a", "APPROVED");
    expect(approved).toMatchObject({ reviewStatus: "APPROVED", reviewedByUserId: "reviewer-a" });
    expect(fake.audits[0]).toMatchObject({ action: "document.approved" });
    await expect(
      reviewDocument(
        clientFor({ ...pending, createdByUserId: "reviewer-a" }, true).client as never,
        manager,
        "document-a",
        "APPROVED",
      ),
    ).rejects.toMatchObject({ code: "DOCUMENT_FOUR_EYES_REQUIRED" });
    await expect(
      reviewDocument(clientFor(pending, false).client as never, manager, "document-a", "APPROVED"),
    ).rejects.toMatchObject({ code: "DOCUMENT_FILE_REQUIRED" });
  });

  it("permits only pending content correction", async () => {
    const pending = {
      id: "document-a",
      companyId: "company-a",
      documentTypeId: "type-a",
      subjectType: "COMPANY",
      reviewStatus: "PENDING_REVIEW",
      archivedAt: null,
      revokedAt: null,
      issueDate: null,
      validFrom: null,
      expiryDate: null,
    };
    await expect(
      updatePendingDocument(
        clientFor({ ...pending, reviewStatus: "APPROVED" }).client as never,
        manager,
        "document-a",
        { expiryDate: "2030-01-01" },
      ),
    ).rejects.toMatchObject({ code: "DOCUMENT_IMMUTABLE" });
  });
});
