import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { permissionCodes, rolePermissionMatrix } from "@/modules/identity/permissions";

const migrationPath =
  "prisma/migrations/20260906000300_phase3b_documents_compliance_foundation/migration.sql";
const runtimeGrantsPath = "prisma/role-provisioning/phase3a-runtime-grants.sql";
const exemptionCorrectionPath =
  "prisma/migrations/20260909000100_phase3b_exemption_effective_from_nullable/migration.sql";
const licenceNumberRenewalPath =
  "prisma/migrations/20260910000100_driver_licence_same_driver_number_renewal/migration.sql";
const phase3bTables = [
  "document_types",
  "compliance_requirements",
  "compliance_requirement_assignments",
  "compliance_requirement_exemptions",
  "documents",
  "stored_files",
  "document_files",
  "driver_licence_files",
  "document_review_history",
];

describe("Phase 3B.1 documents and compliance foundation migration", () => {
  it("replaces global licence-number uniqueness with same-driver exclusion semantics", async () => {
    const sql = await readFile(licenceNumberRenewalPath, "utf8");
    expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS btree_gist");
    expect(sql).toContain("count(DISTINCT driver_id) > 1");
    expect(sql).toContain(
      "DROP CONSTRAINT driver_licences_company_id_licence_number_lookup_hash_key",
    );
    expect(sql).toContain("EXCLUDE USING gist");
    expect(sql).toContain("licence_number_lookup_hash WITH =");
    expect(sql).toContain("driver_id WITH <>");
    expect(sql).toContain("driver_licences_company_lookup_hash_idx");
  });
  it("uses a forward-only open-lower-bound exemption correction", async () => {
    const sql = await readFile(exemptionCorrectionPath, "utf8");
    expect(sql).toContain("ALTER COLUMN effective_from DROP NOT NULL");
    expect(sql).toContain("effective_from IS NULL OR expires_on IS NULL");
    expect(sql).not.toContain("2026-01-01");
  });
  it("creates exactly the approved tenant tables with RLS/FORCE RLS", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const createdTables = [...sql.matchAll(/^CREATE TABLE ([a-z_]+)/gm)].map((match) => match[1]);
    expect(createdTables).toEqual(phase3bTables);
    for (const table of phase3bTables) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(sql).toContain(`CREATE POLICY ${table}_tenant ON ${table}`);
    }
    expect(sql).not.toContain("CREATE TABLE compliance_status");
    expect(sql).not.toContain("CREATE TABLE compliance_snapshot");
    expect(sql).not.toContain("SECURITY DEFINER");
  });

  it("preserves tenant-safe structural references and approved lifecycle constraints", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("REFERENCES document_types(company_id, id, subject_type)");
    expect(sql).toContain("REFERENCES compliance_requirements(company_id, id, subject_type)");
    expect(sql).toContain("REFERENCES drivers(company_id, id)");
    expect(sql).toContain("REFERENCES vehicles(company_id, id)");
    expect(sql).toContain("REFERENCES documents(company_id, id)");
    expect(sql).toContain("REFERENCES stored_files(company_id, id)");
    expect(sql).toContain("REFERENCES driver_licences(company_id, id)");
    expect(sql).toContain("driver_licences_replaces_licence_fk");
    expect(sql).not.toContain("ON DELETE CASCADE");
    expect(sql).toContain("document_types_one_active_driver_licence_source_idx");
    expect(sql).toContain("compliance_requirements_one_active_document_type_idx");
    expect(sql).toContain("driver_licence_files_one_active_role_idx");
    expect(sql).toContain("driver_licences_one_direct_successor_idx");
  });

  it("enforces stored-file, review, removal, and revocation foundation checks", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("octet_length(sha256) = 32");
    expect(sql).toContain("size_bytes <= 10485760");
    expect(sql).toContain("review_status = 'PENDING_REVIEW'");
    expect(sql).toContain("review_status = 'APPROVED'");
    expect(sql).toContain("review_status = 'REJECTED'");
    expect(sql).toContain("removed_at IS NULL AND removed_by_user_id IS NULL");
    expect(sql).toContain("revoked_at IS NULL AND revoked_by_user_id IS NULL");
    expect(sql).toContain("WHEN 'VAN' THEN 'C'::\"DriverLicenceClass\"");
  });
});

describe("Phase 3B.1 RBAC defaults", () => {
  const phase3bPermissions = [
    "documents.read",
    "documents.file.read",
    "documents.manage",
    "documents.review",
    "compliance.read",
    "compliance.manage",
  ] as const;

  it("seeds the approved document and compliance permissions", () => {
    for (const permission of phase3bPermissions) expect(permissionCodes).toContain(permission);
  });

  it("maps Phase 3B permissions to the approved roles", () => {
    for (const role of ["OWNER", "ADMIN", "MANAGER"] as const)
      expect(rolePermissionMatrix[role]).toEqual(expect.arrayContaining([...phase3bPermissions]));
    expect(rolePermissionMatrix.SUPERVISOR).toEqual(
      expect.arrayContaining([
        "documents.read",
        "documents.file.read",
        "documents.manage",
        "documents.review",
        "compliance.read",
      ]),
    );
    expect(rolePermissionMatrix.SUPERVISOR).not.toContain("compliance.manage");
    expect(rolePermissionMatrix.DRIVER).toEqual(
      expect.arrayContaining(["documents.read", "documents.file.read", "compliance.read"]),
    );
    expect(rolePermissionMatrix.DRIVER).not.toEqual(
      expect.arrayContaining(["documents.manage", "documents.review", "compliance.manage"]),
    );
  });
});

describe("Phase 3B.1 runtime grant profile", () => {
  it("keeps new records non-deletable and review history append-only", async () => {
    const grants = await readFile(runtimeGrantsPath, "utf8");
    for (const table of phase3bTables) {
      expect(grants).not.toContain(`DELETE ON ${table}`);
    }
    expect(grants).toContain("GRANT SELECT, INSERT ON document_review_history");
    expect(grants).not.toContain("UPDATE ON document_review_history");
  });
});
