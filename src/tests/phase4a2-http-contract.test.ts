import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { operationalDocumentFileDto } from "@/lib/http/phase3b-dto";

const root = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Phase 4A.2 compliance operational contract", () => {
  it("exposes bounded subject and safe operational document routes", () => {
    for (const file of [
      "src/app/api/companies/[companyId]/compliance/subjects/route.ts",
      "src/app/api/companies/[companyId]/documents/[documentId]/operational/route.ts",
      "src/app/companies/[companyId]/compliance/workspace.tsx",
    ])
      expect(fs.existsSync(path.join(root, file)), file).toBe(true);
    expect(source("src/app/api/companies/[companyId]/compliance/subjects/route.ts")).toContain(
      "listComplianceSubjects",
    );
    expect(
      source("src/app/api/companies/[companyId]/documents/[documentId]/operational/route.ts"),
    ).toContain("getOperationalDocumentDetail");
  });

  it("never exposes private storage location or integrity material", () => {
    const dto = operationalDocumentFileDto({
      id: "association-id",
      companyId: "company-id",
      documentId: "document-id",
      storedFileId: "file-id",
      attachedAt: new Date("2030-01-01T00:00:00.000Z"),
      attachedByUserId: "user-id",
      removedAt: null,
      removedByUserId: null,
      removalReason: null,
      createdAt: new Date("2030-01-01T00:00:00.000Z"),
      storedFile: {
        id: "file-id",
        companyId: "company-id",
        storageProvider: "s3-compatible",
        bucket: "private-bucket",
        objectKey: "private/object/key",
        originalFilename: "evidence.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        sha256: Buffer.from("secret"),
        fileState: "AVAILABLE",
        createdByUserId: "user-id",
        createdAt: new Date("2030-01-01T00:00:00.000Z"),
        updatedAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    });
    expect(dto).toMatchObject({ filename: "evidence.pdf", fileState: "AVAILABLE" });
    expect(JSON.stringify(dto)).not.toMatch(/bucket|objectKey|sha256|storageProvider/i);
  });

  it("uses accepted upload, finalize, attachment and download transports", () => {
    const workspace = source("src/app/companies/[companyId]/compliance/workspace.tsx");
    expect(workspace).toContain("`${base}/files`");
    expect(workspace).toContain("/finalize`");
    expect(workspace).toContain("storedFileId: initiated.data.fileId");
    expect(workspace).toContain("/download`");
    expect(workspace).not.toMatch(/complianceStatus\s*:/);
  });

  it("keeps review and derived compliance decisions on domain-backed routes", () => {
    const workspace = source("src/app/companies/[companyId]/compliance/workspace.tsx");
    expect(workspace).toContain("/approve`");
    expect(workspace).toContain("/reject`");
    expect(workspace).toContain("The creator cannot review their own document.");
    expect(source("src/modules/documents/phase3b-read.service.ts")).toContain(
      'if (context.role === "DRIVER")',
    );
  });
});
