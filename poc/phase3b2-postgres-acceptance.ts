/**
 * Disposable real-PostgreSQL acceptance harness for Phase 3B.2.
 *
 * DATABASE_URL must point to an administrative local PostgreSQL instance. The
 * harness creates a database whose name begins `ois_phase3b2_acceptance_` and
 * drops it in finally. It refuses every other database name.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { withTenantTransaction } from "../src/db/tenant-transaction";
import { evaluateCompanyCompliance } from "../src/modules/compliance/compliance-evaluation.service";
import { selectDriverLicenceAttachmentRepresentation } from "../src/modules/compliance/compliance-evaluation";
import { createComplianceRequirement } from "../src/modules/compliance/requirement.service";
import { assignRequirement } from "../src/modules/compliance/assignment.service";
import { grantRequirementExemption } from "../src/modules/compliance/exemption.service";
import {
  createDocument,
  archiveDocument,
  revokeDocument,
  updatePendingDocument,
} from "../src/modules/documents/document.service";
import { reviewDocument } from "../src/modules/documents/document-review.service";
import {
  attachDocumentFile,
  attachDriverLicenceFile,
} from "../src/modules/documents/file-association.service";
import {
  createStoredFileDownload,
  finalizeStoredFile,
  initiateStoredFile,
  quarantineStoredFile,
} from "../src/modules/documents/stored-file.service";
import { createDocumentType } from "../src/modules/documents/document-type.service";
import { createDriver } from "../src/modules/drivers/driver.service";
import {
  addDriverLicence,
  renewDriverLicence,
  revokeDriverLicence,
  selectDriverLicenceForEvaluation,
} from "../src/modules/drivers/driver-licence.service";
import { LicenceCrypto } from "../src/modules/drivers/licence-crypto";
import { normalizeLicenceNumber } from "../src/modules/drivers/licence-normalization";
import { companyLocalDate } from "../src/modules/companies/company-date";
import { resolveTenantContext } from "../src/modules/identity/tenant-context.service";
import type { FileStorageProvider } from "../src/modules/documents/file-storage";

const sourceUrl = process.env.DATABASE_URL;
const databaseName = `ois_phase3b2_acceptance_${process.pid}_${Date.now()}`;
const runtimeRole = `ois_phase3b2_runtime_${process.pid}`;
const migratorRole = `ois_phase3b2_migrator_${process.pid}`;
const password = randomBytes(32).toString("hex");
const migrationPaths = [
  "prisma/migrations/20260902000100_lean_phase2_initial/migration.sql",
  "prisma/migrations/20260905000100_phase3a_drivers_vehicles_foundation/migration.sql",
  "prisma/migrations/20260906000100_company_membership_tenant_read_rls_hardening/migration.sql",
  "prisma/migrations/20260906000200_company_membership_stage2_read_scope_correction/migration.sql",
  "prisma/migrations/20260906000300_phase3b_documents_compliance_foundation/migration.sql",
  "prisma/migrations/20260909000100_phase3b_exemption_effective_from_nullable/migration.sql",
  "prisma/migrations/20260910000100_driver_licence_same_driver_number_renewal/migration.sql",
];
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

function quote(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function URLFor(url: string, database: string, role?: string) {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  if (role) {
    parsed.username = role;
    parsed.password = password;
  }
  return parsed.toString();
}

function checkpoint(name: string, ok: boolean) {
  console.log(`${name}: ${ok ? "PASS" : "FAIL"}`);
  if (!ok) throw new Error(`${name} failed`);
}

async function rejects(operation: () => Promise<unknown>, code?: string) {
  try {
    await operation();
    return false;
  } catch (error) {
    if (code && (error as { code?: string }).code !== code) throw error;
    return true;
  }
}

class MemoryStorage implements FileStorageProvider {
  readonly contents = new Map<string, Uint8Array>();
  async createUploadUrl() {
    return "memory://upload";
  }
  async inspectObject({ objectKey }: { bucket: string; objectKey: string }) {
    const content = this.contents.get(objectKey);
    if (!content) throw new Error("object missing");
    return { content };
  }
  async createDownloadUrl() {
    return "memory://download";
  }
}

async function createAvailableFile(
  client: PrismaClient,
  context: Awaited<ReturnType<typeof resolveTenantContext>>,
  storage: MemoryStorage,
  filename: string,
  content: Uint8Array,
) {
  const initiated = await initiateStoredFile(
    client,
    context,
    storage,
    "phase3b2-private",
    filename,
  );
  storage.contents.set(initiated.file.objectKey, content);
  return finalizeStoredFile(client, context, storage, initiated.file.id);
}

async function applyMigrations(migratorUrl: string) {
  const client = new Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    for (const path of migrationPaths) await client.query(await readFile(path, "utf8"));
  } finally {
    await client.end();
  }
}

export async function runPhase3b2PostgresAcceptance() {
  if (!sourceUrl) throw new Error("DATABASE_URL is required");
  const sourceDatabase = new URL(sourceUrl).pathname.slice(1);
  if (sourceDatabase.startsWith("ois_phase3b2_acceptance_"))
    throw new Error(
      "DATABASE_URL must name an administrative server database, not a test database",
    );
  const admin = new Client({ connectionString: sourceUrl });
  let runtimePrisma: PrismaClient | undefined;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${quote(databaseName)}`);
    await admin.query(
      `CREATE ROLE ${quote(migratorRole)} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`,
    );
    await admin.query(
      `CREATE ROLE ${quote(runtimeRole)} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`,
    );
    await admin.query(
      `GRANT CONNECT, CREATE ON DATABASE ${quote(databaseName)} TO ${quote(migratorRole)}`,
    );
    await admin.query(`GRANT CONNECT ON DATABASE ${quote(databaseName)} TO ${quote(runtimeRole)}`);
    const migratorUrl = URLFor(sourceUrl, databaseName, migratorRole);
    const bootstrap = new Client({ connectionString: URLFor(sourceUrl, databaseName) });
    await bootstrap.connect();
    try {
      await bootstrap.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${quote(migratorRole)}`);
    } finally {
      await bootstrap.end();
    }
    await applyMigrations(migratorUrl);

    const targetAdminUrl = URLFor(sourceUrl, databaseName);
    const targetAdmin = new Client({ connectionString: targetAdminUrl });
    await targetAdmin.connect();
    try {
      await targetAdmin.query(`GRANT USAGE ON SCHEMA public TO ${quote(runtimeRole)}`);
      await targetAdmin.query(
        `GRANT SELECT,UPDATE ON users TO ${quote(runtimeRole)}; GRANT SELECT ON roles,permissions,role_permissions TO ${quote(runtimeRole)}; GRANT SELECT,INSERT,UPDATE ON companies,company_memberships,locations,activities TO ${quote(runtimeRole)};`,
      );
      await targetAdmin.query(
        `GRANT SELECT,INSERT,UPDATE ON company_operational_settings,vehicle_categories,drivers,driver_regular_availability,driver_licences,driver_vehicle_capabilities,vehicles,vehicle_odometer_readings,document_types,compliance_requirements,compliance_requirement_assignments,compliance_requirement_exemptions,documents,stored_files,document_files,driver_licence_files TO ${quote(runtimeRole)}; GRANT SELECT,INSERT ON vehicle_status_history,document_review_history TO ${quote(runtimeRole)}; REVOKE CREATE ON SCHEMA public FROM ${quote(runtimeRole)};`,
      );
      const nullable = await targetAdmin.query(
        "SELECT is_nullable FROM information_schema.columns WHERE table_name='compliance_requirement_exemptions' AND column_name='effective_from'",
      );
      checkpoint("phase3b2_corrective_migration_nullable", nullable.rows[0]?.is_nullable === "YES");
      const licenceNumberConstraint = await targetAdmin.query(
        "SELECT (SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='btree_gist')) AS extension_present, conname, contype FROM pg_constraint WHERE conname='driver_licences_company_hash_different_driver_excl'",
      );
      checkpoint(
        "phase3b2_driver_licence_number_exclusion_migration",
        licenceNumberConstraint.rows[0]?.extension_present === true &&
          licenceNumberConstraint.rows[0]?.contype === "x",
      );
      const roles = await targetAdmin.query(
        "SELECT rolbypassrls, rolinherit FROM pg_roles WHERE rolname=$1",
        [runtimeRole],
      );
      checkpoint(
        "phase3b2_runtime_role_security",
        roles.rows[0]?.rolbypassrls === false && roles.rows[0]?.rolinherit === false,
      );
      const rls = await targetAdmin.query(
        "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[])",
        [phase3bTables],
      );
      checkpoint(
        "phase3b2_rls_force_rls",
        rls.rows.length === phase3bTables.length &&
          rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity),
      );

      // Bootstrap deterministic fixture identities through the controlled admin path.
      const owner = randomUUID();
      const reviewer = randomUUID();
      const companyId = randomUUID();
      const ownerRole = (
        await targetAdmin.query(
          "INSERT INTO roles(code,name) VALUES ('OWNER','Owner') RETURNING id",
        )
      ).rows[0].id;
      const adminRole = (
        await targetAdmin.query(
          "INSERT INTO roles(code,name) VALUES ('ADMIN','Admin') RETURNING id",
        )
      ).rows[0].id;
      const driverRole = (
        await targetAdmin.query(
          "INSERT INTO roles(code,name) VALUES ('DRIVER','Driver') RETURNING id",
        )
      ).rows[0].id;
      await targetAdmin.query(
        "INSERT INTO users(id,email,account_status,updated_at) VALUES ($1,'owner@phase3b2.test','ACTIVE',now()),($2,'reviewer@phase3b2.test','ACTIVE',now())",
        [owner, reviewer],
      );
      await targetAdmin.query(
        "INSERT INTO companies(id,name,slug,status,updated_at) VALUES ($1,'Phase 3B.2','phase3b2-test','ACTIVE',now())",
        [companyId],
      );
      const permissions = [
        "drivers.manage",
        "drivers.read",
        "documents.read",
        "documents.file.read",
        "documents.manage",
        "documents.review",
        "compliance.read",
        "compliance.manage",
      ];
      for (const code of permissions) {
        const row = await targetAdmin.query(
          "INSERT INTO permissions(code,description) VALUES ($1,$1) RETURNING id",
          [code],
        );
        await targetAdmin.query(
          "INSERT INTO role_permissions(role_id,permission_id) VALUES ($1,$2)",
          [ownerRole, row.rows[0].id],
        );
        await targetAdmin.query(
          "INSERT INTO role_permissions(role_id,permission_id) VALUES ($1,$2)",
          [adminRole, row.rows[0].id],
        );
      }
      for (const code of [
        "drivers.read",
        "documents.read",
        "documents.file.read",
        "compliance.read",
      ]) {
        const permission = await targetAdmin.query("SELECT id FROM permissions WHERE code=$1", [
          code,
        ]);
        await targetAdmin.query(
          "INSERT INTO role_permissions(role_id,permission_id) VALUES ($1,$2)",
          [driverRole, permission.rows[0].id],
        );
      }
      await targetAdmin.query(
        "INSERT INTO company_memberships(company_id,user_id,role_id,status,updated_at) VALUES ($1,$2,$3,'ACTIVE',now()),($1,$4,$5,'ACTIVE',now())",
        [companyId, owner, ownerRole, reviewer, adminRole],
      );

      runtimePrisma = new PrismaClient({
        datasources: { db: { url: URLFor(sourceUrl, databaseName, runtimeRole) } },
      });
      await runtimePrisma.$connect();
      const [ownerContext, reviewerContext] = await Promise.all([
        resolveTenantContext(runtimePrisma, { userId: owner }, companyId),
        resolveTenantContext(runtimePrisma, { userId: reviewer }, companyId),
      ]);
      const storage = new MemoryStorage();
      const driver = await createDriver(runtimePrisma, ownerContext, {
        displayName: "Acceptance driver",
      });
      const type = await createDocumentType(runtimePrisma, ownerContext, {
        code: "SAFETY_CARD",
        name: "Safety card",
        subjectType: "DRIVER",
        evidenceSourceType: "DOCUMENT",
        requiresExpiryDate: true,
      });
      const requirement = await createComplianceRequirement(runtimePrisma, ownerContext, {
        documentTypeId: type.id,
        subjectType: "DRIVER",
        applicability: "GLOBAL",
        name: "Safety card required",
        expiryWarningDays: 30,
      });
      const document = await createDocument(runtimePrisma, ownerContext, {
        documentTypeId: type.id,
        subjectType: "DRIVER",
        driverId: driver.id,
        expiryDate: "2030-01-01",
      });
      const pending = await evaluateCompanyCompliance(
        runtimePrisma,
        ownerContext,
        new Date("2026-01-01"),
      );
      checkpoint(
        "phase3b2_pending_document_not_evidence",
        pending.obligations.some(
          (item) => item.requirementId === requirement.id && item.status === "MISSING",
        ),
      );
      const initiated = await initiateStoredFile(
        runtimePrisma,
        ownerContext,
        storage,
        "phase3b2-private",
        "safety.pdf",
      );
      storage.contents.set(initiated.file.objectKey, new TextEncoder().encode("%PDF-1.7"));
      await finalizeStoredFile(runtimePrisma, ownerContext, storage, initiated.file.id);
      await attachDocumentFile(runtimePrisma, ownerContext, document.id, initiated.file.id);
      await reviewDocument(runtimePrisma, reviewerContext, document.id, "APPROVED");
      const compliant = await evaluateCompanyCompliance(
        runtimePrisma,
        ownerContext,
        new Date("2026-01-01"),
      );
      checkpoint(
        "phase3b2_document_lifecycle_and_evaluation",
        compliant.obligations.some(
          (item) => item.requirementId === requirement.id && item.status === "COMPLIANT",
        ),
      );
      await archiveDocument(runtimePrisma, ownerContext, document.id);
      const archived = await evaluateCompanyCompliance(
        runtimePrisma,
        ownerContext,
        new Date("2026-01-01"),
      );
      checkpoint(
        "phase3b2_archive_removes_evidence",
        archived.obligations.some(
          (item) => item.requirementId === requirement.id && item.status === "MISSING",
        ),
      );

      // The same real services must also make revocation immediately unusable.
      const revocable = await createDocument(runtimePrisma, ownerContext, {
        documentTypeId: type.id,
        subjectType: "DRIVER",
        driverId: driver.id,
        expiryDate: "2030-01-01",
      });
      const revocableFile = await initiateStoredFile(
        runtimePrisma,
        ownerContext,
        storage,
        "phase3b2-private",
        "revoke.pdf",
      );
      storage.contents.set(revocableFile.file.objectKey, new TextEncoder().encode("%PDF-1.7"));
      await finalizeStoredFile(runtimePrisma, ownerContext, storage, revocableFile.file.id);
      await attachDocumentFile(runtimePrisma, ownerContext, revocable.id, revocableFile.file.id);
      await reviewDocument(runtimePrisma, reviewerContext, revocable.id, "APPROVED");
      await revokeDocument(runtimePrisma, ownerContext, revocable.id, "validation revocation");
      const revoked = await evaluateCompanyCompliance(
        runtimePrisma,
        ownerContext,
        new Date("2026-01-01"),
      );
      checkpoint(
        "phase3b2_revoke_removes_evidence",
        revoked.obligations.some(
          (item) => item.requirementId === requirement.id && item.status === "MISSING",
        ),
      );

      // Actual runtime-RLS/composite-FK probes use an independent tenant.
      const companyB = randomUUID();
      await targetAdmin.query(
        "INSERT INTO companies(id,name,slug,status,updated_at) VALUES ($1,'Phase 3B.2 B','phase3b2-test-b','ACTIVE',now())",
        [companyB],
      );
      const runtimeSql = new Client({
        connectionString: URLFor(sourceUrl, databaseName, runtimeRole),
      });
      await runtimeSql.connect();
      try {
        await runtimeSql.query("BEGIN");
        await runtimeSql.query("SELECT set_config('app.current_user_id',$1,true)", [owner]);
        await runtimeSql.query("SELECT set_config('app.current_company_id',$1,true)", [companyB]);
        const crossTenantRead = await runtimeSql.query(
          "SELECT id FROM documents WHERE company_id=$1",
          [companyId],
        );
        const crossTenantDocumentType = await rejects(() =>
          runtimeSql.query(
            "INSERT INTO compliance_requirements(company_id,document_type_id,subject_type,applicability,name) VALUES ($1,$2,'DRIVER','GLOBAL','invalid cross tenant')",
            [companyB, type.id],
          ),
        );
        await runtimeSql.query("ROLLBACK");
        checkpoint(
          "phase3b2_cross_tenant_rls_and_composite_fk",
          crossTenantRead.rowCount === 0 && crossTenantDocumentType,
        );
      } finally {
        await runtimeSql.end();
      }
      await targetAdmin.query(
        "INSERT INTO document_types(company_id,code,name,subject_type,evidence_source_type) VALUES ($1,'B_ONLY','B only','DRIVER','DOCUMENT')",
        [companyB],
      );
      let pooledIsolation = true;
      for (let index = 0; index < 20; index += 1) {
        const selectedCompany = index % 2 === 0 ? companyId : companyB;
        const expectedCode = index % 2 === 0 ? "SAFETY_CARD" : "B_ONLY";
        const rows = await runtimePrisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_user_id', ${owner}, true)`;
          await tx.$executeRaw`SELECT set_config('app.current_company_id', ${selectedCompany}, true)`;
          return tx.$queryRaw<
            Array<{ code: string }>
          >`SELECT code FROM document_types ORDER BY code`;
        });
        if (!rows.some((row) => row.code === expectedCode)) pooledIsolation = false;
      }
      const noLeakedContext = await runtimePrisma.$transaction((tx) => tx.documentType.count());
      checkpoint(
        "phase3b2_prisma_pooled_tenant_context_isolation",
        pooledIsolation && noLeakedContext === 0,
      );

      const specificType = await createDocumentType(runtimePrisma, ownerContext, {
        code: "SPECIFIC_CARD",
        name: "Specific card",
        subjectType: "DRIVER",
        evidenceSourceType: "DOCUMENT",
      });
      const specificRequirement = await createComplianceRequirement(runtimePrisma, ownerContext, {
        documentTypeId: specificType.id,
        subjectType: "DRIVER",
        applicability: "SPECIFIC",
        name: "Specific card required",
      });
      const beforeAssignment = await evaluateCompanyCompliance(
        runtimePrisma,
        ownerContext,
        new Date("2026-01-01"),
      );
      await assignRequirement(runtimePrisma, ownerContext, {
        requirementId: specificRequirement.id,
        subjectType: "DRIVER",
        driverId: driver.id,
      });
      const afterAssignment = await evaluateCompanyCompliance(
        runtimePrisma,
        ownerContext,
        new Date("2026-01-01"),
      );
      const openExemption = await grantRequirementExemption(runtimePrisma, ownerContext, {
        requirementId: specificRequirement.id,
        subjectType: "DRIVER",
        driverId: driver.id,
        reason: "open interval",
        effectiveFrom: null,
        expiresOn: null,
      });
      const exempted = await evaluateCompanyCompliance(
        runtimePrisma,
        ownerContext,
        new Date("2026-01-01"),
      );
      checkpoint(
        "phase3b2_specific_assignment_and_open_exemption",
        !beforeAssignment.obligations.some(
          (item) => item.requirementId === specificRequirement.id,
        ) &&
          afterAssignment.obligations.some(
            (item) => item.requirementId === specificRequirement.id,
          ) &&
          !exempted.obligations.some((item) => item.requirementId === specificRequirement.id) &&
          Boolean(openExemption.id),
      );
      const duplicateAssignment = await rejects(
        () =>
          assignRequirement(runtimePrisma!, ownerContext, {
            requirementId: specificRequirement.id,
            subjectType: "DRIVER",
            driverId: driver.id,
          }),
        "DUPLICATE_ACTIVE_ASSIGNMENT",
      );
      const overlappingExemption = await rejects(
        () =>
          grantRequirementExemption(runtimePrisma!, ownerContext, {
            requirementId: specificRequirement.id,
            subjectType: "DRIVER",
            driverId: driver.id,
            reason: "overlap",
            effectiveFrom: "2026-01-01",
            expiresOn: "2026-12-31",
          }),
        "OVERLAPPING_EXEMPTION",
      );
      checkpoint(
        "phase3b2_partial_unique_and_overlap_constraints",
        duplicateAssignment && overlappingExemption,
      );

      const crypto = new LicenceCrypto({ rootKey: randomBytes(32), keyVersion: "phase3b2-test" });
      const predecessor = await addDriverLicence(runtimePrisma, ownerContext, crypto, driver.id, {
        licenceNumber: "A-123456",
        expiresOn: "2030-12-31",
      });
      const licenceType = await createDocumentType(runtimePrisma, ownerContext, {
        code: "DRIVER_LICENCE_EVIDENCE",
        name: "Driver licence evidence",
        subjectType: "DRIVER",
        evidenceSourceType: "DRIVER_LICENCE",
      });
      const licenceRequirement = await createComplianceRequirement(runtimePrisma, ownerContext, {
        documentTypeId: licenceType.id,
        subjectType: "DRIVER",
        applicability: "GLOBAL",
        name: "Driver licence required",
      });
      const front = await initiateStoredFile(
        runtimePrisma,
        ownerContext,
        storage,
        "phase3b2-private",
        "front.jpg",
      );
      const back = await initiateStoredFile(
        runtimePrisma,
        ownerContext,
        storage,
        "phase3b2-private",
        "back.png",
      );
      storage.contents.set(front.file.objectKey, Uint8Array.from([0xff, 0xd8, 0xff]));
      storage.contents.set(
        back.file.objectKey,
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      await finalizeStoredFile(runtimePrisma, ownerContext, storage, front.file.id);
      await finalizeStoredFile(runtimePrisma, ownerContext, storage, back.file.id);
      await attachDriverLicenceFile(
        runtimePrisma,
        ownerContext,
        predecessor.id,
        front.file.id,
        "FRONT",
      );
      await attachDriverLicenceFile(
        runtimePrisma,
        ownerContext,
        predecessor.id,
        back.file.id,
        "BACK",
      );
      const licenceEvidence = await evaluateCompanyCompliance(
        runtimePrisma,
        ownerContext,
        new Date("2026-01-01"),
      );
      checkpoint(
        "phase3b2_driver_licence_front_back_evidence",
        licenceEvidence.obligations.some(
          (item) => item.requirementId === licenceRequirement.id && item.status === "COMPLIANT",
        ),
      );
      const successor = await renewDriverLicence(
        runtimePrisma,
        ownerContext,
        crypto,
        driver.id,
        predecessor.id,
        {
          // Australian licence renewals may retain the predecessor number.
          licenceNumber: "A-123456",
          licenceClass: "HR",
          validFrom: "2027-01-01",
          expiresOn: "2032-12-31",
        },
      );
      const crossDriver = await createDriver(runtimePrisma, ownerContext, {
        displayName: "Cross-driver licence number validation",
      });
      const crossDriverReuseDenied = await rejects(
        () =>
          addDriverLicence(runtimePrisma!, ownerContext, crypto, crossDriver.id, {
            licenceNumber: "A-123456",
            expiresOn: "2030-12-31",
          }),
        "DUPLICATE_LICENCE",
      );
      const secondSuccessor = await rejects(
        () =>
          renewDriverLicence(runtimePrisma!, ownerContext, crypto, driver.id, predecessor.id, {
            licenceNumber: "C-123456",
            licenceClass: "HR",
            validFrom: "2027-02-01",
            expiresOn: "2032-12-31",
          }),
        "LICENCE_RENEWAL_CONFLICT",
      );
      const effectiveSuccessorIncomplete = await evaluateCompanyCompliance(
        runtimePrisma,
        ownerContext,
        new Date("2027-02-01"),
      );
      await revokeDriverLicence(runtimePrisma, ownerContext, driver.id, successor.id, {
        reason: "validation revocation",
      });
      const revokedSuccessor = await evaluateCompanyCompliance(
        runtimePrisma,
        ownerContext,
        new Date("2027-02-01"),
      );
      checkpoint(
        "phase3b2_licence_replacement_integrity",
        crossDriverReuseDenied &&
          secondSuccessor &&
          effectiveSuccessorIncomplete.obligations.some(
            (item) =>
              item.requirementId === licenceRequirement.id &&
              item.status === "MISSING" &&
              item.reason === "LICENCE_EVIDENCE_INCOMPLETE",
          ) &&
          revokedSuccessor.obligations.some(
            (item) => item.requirementId === licenceRequirement.id && item.status === "MISSING",
          ),
      );

      // Two independent Prisma clients exercise the SELECT ... FOR UPDATE paths.
      const runtimePrismaB = new PrismaClient({
        datasources: { db: { url: URLFor(sourceUrl, databaseName, runtimeRole) } },
      });
      await runtimePrismaB.$connect();
      try {
        const reviewTarget = await createDocument(runtimePrisma, ownerContext, {
          documentTypeId: type.id,
          subjectType: "DRIVER",
          driverId: driver.id,
          expiryDate: "2030-01-01",
        });
        const reviewFile = await initiateStoredFile(
          runtimePrisma,
          ownerContext,
          storage,
          "phase3b2-private",
          "concurrent.pdf",
        );
        storage.contents.set(reviewFile.file.objectKey, new TextEncoder().encode("%PDF-1.7"));
        await finalizeStoredFile(runtimePrisma, ownerContext, storage, reviewFile.file.id);
        await attachDocumentFile(runtimePrisma, ownerContext, reviewTarget.id, reviewFile.file.id);
        const reviewResults = await Promise.allSettled([
          reviewDocument(runtimePrisma, reviewerContext, reviewTarget.id, "APPROVED"),
          reviewDocument(runtimePrismaB, reviewerContext, reviewTarget.id, "APPROVED"),
        ]);
        const finalHistory = await withTenantTransaction(runtimePrisma, ownerContext, (tx) =>
          tx.documentReviewHistory.count({ where: { documentId: reviewTarget.id } }),
        );
        checkpoint(
          "phase3b2_concurrent_document_review_serializes",
          reviewResults.filter((result) => result.status === "fulfilled").length === 1 &&
            reviewResults.filter((result) => result.status === "rejected").length === 1 &&
            finalHistory === 1,
        );

        const renewalDriver = await createDriver(runtimePrisma, ownerContext, {
          displayName: "Concurrent renewal driver",
        });
        const renewalPredecessor = await addDriverLicence(
          runtimePrisma,
          ownerContext,
          crypto,
          renewalDriver.id,
          { licenceNumber: "R-000001", expiresOn: "2030-12-31" },
        );
        const renewals = await Promise.allSettled([
          renewDriverLicence(
            runtimePrisma,
            ownerContext,
            crypto,
            renewalDriver.id,
            renewalPredecessor.id,
            {
              licenceNumber: "R-000002",
              licenceClass: "HR",
              validFrom: "2027-01-01",
              expiresOn: "2032-12-31",
            },
          ),
          renewDriverLicence(
            runtimePrismaB,
            ownerContext,
            crypto,
            renewalDriver.id,
            renewalPredecessor.id,
            {
              licenceNumber: "R-000003",
              licenceClass: "HR",
              validFrom: "2027-01-02",
              expiresOn: "2032-12-31",
            },
          ),
        ]);
        checkpoint(
          "phase3b2_concurrent_licence_replacement_serializes",
          renewals.filter((result) => result.status === "fulfilled").length === 1 &&
            renewals.filter((result) => result.status === "rejected").length === 1 &&
            renewals.some(
              (result) =>
                result.status === "rejected" &&
                (result.reason as { code?: string }).code === "LICENCE_RENEWAL_CONFLICT",
            ),
        );

        const sameDriverNormal = await createDriver(runtimePrisma, ownerContext, {
          displayName: "Concurrent normal licence driver",
        });
        const sameDriverCreates = await Promise.allSettled([
          addDriverLicence(runtimePrisma, ownerContext, crypto, sameDriverNormal.id, {
            licenceNumber: "NORMAL-RACE-0001",
            expiresOn: "2030-12-31",
          }),
          addDriverLicence(runtimePrismaB, ownerContext, crypto, sameDriverNormal.id, {
            licenceNumber: "NORMAL-RACE-0001",
            expiresOn: "2030-12-31",
          }),
        ]);
        const crossDriverA = await createDriver(runtimePrisma, ownerContext, {
          displayName: "Cross-driver number A",
        });
        const crossDriverB = await createDriver(runtimePrisma, ownerContext, {
          displayName: "Cross-driver number B",
        });
        const crossDriverCreates = await Promise.allSettled([
          addDriverLicence(runtimePrisma, ownerContext, crypto, crossDriverA.id, {
            licenceNumber: "CROSS-DRIVER-RACE-0001",
            expiresOn: "2030-12-31",
          }),
          addDriverLicence(runtimePrismaB, ownerContext, crypto, crossDriverB.id, {
            licenceNumber: "CROSS-DRIVER-RACE-0001",
            expiresOn: "2030-12-31",
          }),
        ]);
        const [sameDriverOwnership, crossDriverOwnership] = await Promise.all([
          withTenantTransaction(runtimePrisma, ownerContext, async (transaction) => {
            const licences = await transaction.driverLicence.findMany({
              where: {
                companyId: ownerContext.companyId,
                licenceNumberLookupHash: Uint8Array.from(
                  crypto.lookupHash(
                    ownerContext.companyId,
                    normalizeLicenceNumber("NORMAL-RACE-0001"),
                  ),
                ),
              },
              select: { driverId: true },
            });
            return {
              rows: licences.length,
              distinctOwners: new Set(licences.map((licence) => licence.driverId)).size,
            };
          }),
          withTenantTransaction(runtimePrisma, ownerContext, async (transaction) => {
            const licences = await transaction.driverLicence.findMany({
              where: {
                companyId: ownerContext.companyId,
                licenceNumberLookupHash: Uint8Array.from(
                  crypto.lookupHash(
                    ownerContext.companyId,
                    normalizeLicenceNumber("CROSS-DRIVER-RACE-0001"),
                  ),
                ),
              },
              select: { driverId: true },
            });
            return {
              rows: licences.length,
              distinctOwners: new Set(licences.map((licence) => licence.driverId)).size,
            };
          }),
        ]);
        const ownershipSerializes =
          sameDriverCreates.filter((result) => result.status === "fulfilled").length === 1 &&
          sameDriverCreates.some(
            (result) =>
              result.status === "rejected" &&
              (result.reason as { code?: string }).code === "DUPLICATE_LICENCE",
          ) &&
          crossDriverCreates.filter((result) => result.status === "fulfilled").length === 1 &&
          crossDriverCreates.some(
            (result) =>
              result.status === "rejected" &&
              (result.reason as { code?: string }).code === "DUPLICATE_LICENCE",
          ) &&
          sameDriverOwnership.rows === 1 &&
          sameDriverOwnership.distinctOwners === 1 &&
          crossDriverOwnership.rows === 1 &&
          crossDriverOwnership.distinctOwners === 1;
        checkpoint("phase3b2_driver_licence_number_ownership_serializes", ownershipSerializes);

        const overlapDriver = await createDriver(runtimePrisma, ownerContext, {
          displayName: "Concurrent exemption driver",
        });
        const overlapType = await createDocumentType(runtimePrisma, ownerContext, {
          code: "CONCURRENT_EXEMPTION_CARD",
          name: "Concurrent exemption card",
          subjectType: "DRIVER",
          evidenceSourceType: "DOCUMENT",
        });
        const overlapRequirement = await createComplianceRequirement(runtimePrisma, ownerContext, {
          documentTypeId: overlapType.id,
          subjectType: "DRIVER",
          applicability: "SPECIFIC",
          name: "Concurrent exemption requirement",
        });
        await assignRequirement(runtimePrisma, ownerContext, {
          requirementId: overlapRequirement.id,
          subjectType: "DRIVER",
          driverId: overlapDriver.id,
        });
        const overlaps = await Promise.allSettled([
          grantRequirementExemption(runtimePrisma, ownerContext, {
            requirementId: overlapRequirement.id,
            subjectType: "DRIVER",
            driverId: overlapDriver.id,
            reason: "first",
            effectiveFrom: "2026-01-01",
            expiresOn: "2026-12-31",
          }),
          grantRequirementExemption(runtimePrismaB, ownerContext, {
            requirementId: overlapRequirement.id,
            subjectType: "DRIVER",
            driverId: overlapDriver.id,
            reason: "second",
            effectiveFrom: "2026-06-01",
            expiresOn: "2027-06-01",
          }),
        ]);
        checkpoint(
          "phase3b2_concurrent_exemption_overlap_serializes",
          overlaps.filter((result) => result.status === "fulfilled").length === 1 &&
            overlaps.filter((result) => result.status === "rejected").length === 1,
        );
      } finally {
        await runtimePrismaB.$disconnect();
      }

      // AVAILABLE evidence ceases to be usable immediately when quarantined.
      const quarantinedDocument = await createDocument(runtimePrisma, ownerContext, {
        documentTypeId: type.id,
        subjectType: "DRIVER",
        driverId: driver.id,
        expiryDate: "2030-01-01",
      });
      const quarantinedDocumentFile = await createAvailableFile(
        runtimePrisma,
        ownerContext,
        storage,
        "later-quarantined.pdf",
        new TextEncoder().encode("%PDF-1.7"),
      );
      await attachDocumentFile(
        runtimePrisma,
        ownerContext,
        quarantinedDocument.id,
        quarantinedDocumentFile.id,
      );
      await reviewDocument(runtimePrisma, reviewerContext, quarantinedDocument.id, "APPROVED");
      const beforeQuarantine = await evaluateCompanyCompliance(
        runtimePrisma,
        ownerContext,
        new Date("2026-01-01"),
      );
      await quarantineStoredFile(runtimePrisma, ownerContext, quarantinedDocumentFile.id);
      const afterQuarantine = await evaluateCompanyCompliance(
        runtimePrisma,
        ownerContext,
        new Date("2026-01-01"),
      );
      checkpoint(
        "phase3b2_available_to_quarantined_removes_evidence",
        beforeQuarantine.obligations.some(
          (item) => item.requirementId === requirement.id && item.status === "COMPLIANT",
        ) &&
          afterQuarantine.obligations.some(
            (item) => item.requirementId === requirement.id && item.status === "MISSING",
          ),
      );

      await targetAdmin.query("UPDATE companies SET timezone='America/Los_Angeles' WHERE id=$1", [
        companyId,
      ]);
      const timezone = await withTenantTransaction(runtimePrisma, ownerContext, (tx) =>
        tx.company.findUnique({ where: { id: companyId }, select: { timezone: true } }),
      );
      const localExpiryDate = companyLocalDate(
        new Date("2026-01-02T07:30:00.000Z"),
        timezone?.timezone ?? "UTC",
      );
      const nextLocalDate = companyLocalDate(
        new Date("2026-01-02T08:30:00.000Z"),
        timezone?.timezone ?? "UTC",
      );
      const timezoneType = await createDocumentType(runtimePrisma, ownerContext, {
        code: "TIMEZONE_CARD",
        name: "Timezone card",
        subjectType: "DRIVER",
        evidenceSourceType: "DOCUMENT",
        requiresExpiryDate: true,
      });
      const timezoneRequirement = await createComplianceRequirement(runtimePrisma, ownerContext, {
        documentTypeId: timezoneType.id,
        subjectType: "DRIVER",
        applicability: "GLOBAL",
        name: "Timezone card required",
        expiryWarningDays: 0,
      });
      const timezoneDocument = await createDocument(runtimePrisma, ownerContext, {
        documentTypeId: timezoneType.id,
        subjectType: "DRIVER",
        driverId: driver.id,
        expiryDate: "2026-01-01",
      });
      const timezoneFile = await createAvailableFile(
        runtimePrisma,
        ownerContext,
        storage,
        "timezone.pdf",
        new TextEncoder().encode("%PDF-1.7"),
      );
      await attachDocumentFile(runtimePrisma, ownerContext, timezoneDocument.id, timezoneFile.id);
      await reviewDocument(runtimePrisma, reviewerContext, timezoneDocument.id, "APPROVED");
      const atCompanyLocalExpiry = await evaluateCompanyCompliance(
        runtimePrisma,
        ownerContext,
        localExpiryDate,
      );
      const afterCompanyLocalExpiry = await evaluateCompanyCompliance(
        runtimePrisma,
        ownerContext,
        nextLocalDate,
      );
      checkpoint(
        "phase3b2_company_local_expiry_boundary",
        localExpiryDate.toISOString().startsWith("2026-01-01") &&
          nextLocalDate.toISOString().startsWith("2026-01-02") &&
          atCompanyLocalExpiry.obligations.some(
            (item) =>
              item.requirementId === timezoneRequirement.id && item.status === "EXPIRING_SOON",
          ) &&
          afterCompanyLocalExpiry.obligations.some(
            (item) => item.requirementId === timezoneRequirement.id && item.status === "EXPIRED",
          ),
      );

      // The existing FRONT/BACK fixture may coexist with a COMBINED PDF; COMBINED is preferred.
      const combinedForPredecessor = await createAvailableFile(
        runtimePrisma,
        ownerContext,
        storage,
        "licence-combined.pdf",
        new TextEncoder().encode("%PDF-1.7"),
      );
      await attachDriverLicenceFile(
        runtimePrisma,
        ownerContext,
        predecessor.id,
        combinedForPredecessor.id,
        "COMBINED",
      );
      const allLicenceRoles = await withTenantTransaction(runtimePrisma, ownerContext, (tx) =>
        tx.driverLicenceFile.findMany({
          where: { companyId, driverLicenceId: predecessor.id, removedAt: null },
          select: { role: true },
        }),
      );
      const combinedDriver = await createDriver(runtimePrisma, ownerContext, {
        displayName: "Combined evidence driver",
      });
      const combinedLicence = await addDriverLicence(
        runtimePrisma,
        ownerContext,
        crypto,
        combinedDriver.id,
        { licenceNumber: "COMBINED-0001", expiresOn: "2030-12-31" },
      );
      const combinedFile = await createAvailableFile(
        runtimePrisma,
        ownerContext,
        storage,
        "combined-only.pdf",
        new TextEncoder().encode("%PDF-1.7"),
      );
      await attachDriverLicenceFile(
        runtimePrisma,
        ownerContext,
        combinedLicence.id,
        combinedFile.id,
        "COMBINED",
      );
      const frontOnlyDriver = await createDriver(runtimePrisma, ownerContext, {
        displayName: "Incomplete licence driver",
      });
      const frontOnlyLicence = await addDriverLicence(
        runtimePrisma,
        ownerContext,
        crypto,
        frontOnlyDriver.id,
        { licenceNumber: "FRONTONLY-0001", expiresOn: "2030-12-31" },
      );
      const frontOnlyFile = await createAvailableFile(
        runtimePrisma,
        ownerContext,
        storage,
        "front-only.jpg",
        Uint8Array.from([0xff, 0xd8, 0xff]),
      );
      await attachDriverLicenceFile(
        runtimePrisma,
        ownerContext,
        frontOnlyLicence.id,
        frontOnlyFile.id,
        "FRONT",
      );
      const licenceVariants = await evaluateCompanyCompliance(
        runtimePrisma,
        ownerContext,
        new Date("2026-01-01"),
      );
      await quarantineStoredFile(runtimePrisma, ownerContext, combinedFile.id);
      const quarantinedLicenceEvidence = await evaluateCompanyCompliance(
        runtimePrisma,
        ownerContext,
        new Date("2026-01-01"),
      );
      checkpoint(
        "phase3b2_driver_licence_attachment_variants",
        ["FRONT", "BACK", "COMBINED"].every((role) =>
          allLicenceRoles.some((attachment) => attachment.role === role),
        ) &&
          selectDriverLicenceAttachmentRepresentation(
            allLicenceRoles.map((attachment) => attachment.role),
          ) === "COMBINED" &&
          licenceVariants.obligations.some(
            (item) =>
              item.requirementId === licenceRequirement.id &&
              item.subjectId === combinedDriver.id &&
              item.status === "COMPLIANT",
          ) &&
          licenceVariants.obligations.some(
            (item) =>
              item.requirementId === licenceRequirement.id &&
              item.subjectId === frontOnlyDriver.id &&
              item.status === "MISSING" &&
              item.reason === "LICENCE_EVIDENCE_INCOMPLETE",
          ) &&
          quarantinedLicenceEvidence.obligations.some(
            (item) =>
              item.requirementId === licenceRequirement.id &&
              item.subjectId === combinedDriver.id &&
              item.status === "MISSING" &&
              item.reason === "LICENCE_EVIDENCE_INCOMPLETE",
          ),
      );

      const ambiguousDriver = await createDriver(runtimePrisma, ownerContext, {
        displayName: "Ambiguous legacy licence driver",
      });
      const ambiguousOne = await addDriverLicence(
        runtimePrisma,
        ownerContext,
        crypto,
        ambiguousDriver.id,
        {
          licenceNumber: "AMBIGUOUS-0001",
          expiresOn: "2030-12-31",
        },
      );
      const ambiguousTwo = await addDriverLicence(
        runtimePrisma,
        ownerContext,
        crypto,
        ambiguousDriver.id,
        {
          licenceNumber: "AMBIGUOUS-0002",
          expiresOn: "2030-12-31",
        },
      );
      for (const [licence, filename] of [
        [ambiguousOne, "ambiguous-one.pdf"],
        [ambiguousTwo, "ambiguous-two.pdf"],
      ] as const) {
        const file = await createAvailableFile(
          runtimePrisma,
          ownerContext,
          storage,
          filename,
          new TextEncoder().encode("%PDF-1.7"),
        );
        await attachDriverLicenceFile(runtimePrisma, ownerContext, licence.id, file.id, "COMBINED");
      }
      const ambiguousSelection = await selectDriverLicenceForEvaluation(
        runtimePrisma,
        ownerContext,
        ambiguousDriver.id,
        new Date("2026-01-01"),
      );
      const ambiguousEvaluation = await evaluateCompanyCompliance(
        runtimePrisma,
        ownerContext,
        new Date("2026-01-01"),
      );
      checkpoint(
        "phase3b2_ambiguous_legacy_licence_never_compliant",
        ambiguousSelection.kind === "AMBIGUOUS" &&
          ambiguousEvaluation.obligations.some(
            (item) =>
              item.requirementId === licenceRequirement.id &&
              item.subjectId === ambiguousDriver.id &&
              item.status === "MISSING" &&
              item.reason === "DRIVER_LICENCE_AMBIGUOUS",
          ),
      );

      const selfUser = randomUUID();
      const otherDriverUser = randomUUID();
      await targetAdmin.query(
        "INSERT INTO users(id,email,account_status,updated_at) VALUES ($1,'self-driver@phase3b2.test','ACTIVE',now()),($2,'other-driver@phase3b2.test','ACTIVE',now())",
        [selfUser, otherDriverUser],
      );
      await targetAdmin.query(
        "INSERT INTO company_memberships(company_id,user_id,role_id,status,updated_at) VALUES ($1,$2,$3,'ACTIVE',now()),($1,$4,$3,'ACTIVE',now())",
        [companyId, selfUser, driverRole, otherDriverUser],
      );
      const selfDriver = await createDriver(runtimePrisma, ownerContext, {
        displayName: "Self-scoped driver",
        userId: selfUser,
      });
      const otherDriver = await createDriver(runtimePrisma, ownerContext, {
        displayName: "Other self-scoped driver",
        userId: otherDriverUser,
      });
      const selfContext = await resolveTenantContext(
        runtimePrisma,
        { userId: selfUser },
        companyId,
      );
      const selfType = await createDocumentType(runtimePrisma, ownerContext, {
        code: "SELF_SCOPE_CARD",
        name: "Self scope card",
        subjectType: "DRIVER",
        evidenceSourceType: "DOCUMENT",
      });
      const ownPendingDocument = await createDocument(runtimePrisma, selfContext, {
        documentTypeId: selfType.id,
        subjectType: "DRIVER",
        driverId: selfDriver.id,
      });
      await updatePendingDocument(runtimePrisma, selfContext, ownPendingDocument.id, {
        validFrom: "2026-01-01",
      });
      const ownFile = await createAvailableFile(
        runtimePrisma,
        selfContext,
        storage,
        "self-scope.pdf",
        new TextEncoder().encode("%PDF-1.7"),
      );
      await attachDocumentFile(runtimePrisma, selfContext, ownPendingDocument.id, ownFile.id);
      const ownDownload = await createStoredFileDownload(
        runtimePrisma,
        selfContext,
        storage,
        ownFile.id,
      );
      const selfLicence = await addDriverLicence(
        runtimePrisma,
        ownerContext,
        crypto,
        selfDriver.id,
        { licenceNumber: "SELF-SCOPE-0001", expiresOn: "2030-12-31" },
      );
      const ownLicenceFile = await createAvailableFile(
        runtimePrisma,
        selfContext,
        storage,
        "self-licence.pdf",
        new TextEncoder().encode("%PDF-1.7"),
      );
      await attachDriverLicenceFile(
        runtimePrisma,
        selfContext,
        selfLicence.id,
        ownLicenceFile.id,
        "COMBINED",
      );
      const otherPendingDocument = await createDocument(runtimePrisma, ownerContext, {
        documentTypeId: selfType.id,
        subjectType: "DRIVER",
        driverId: otherDriver.id,
      });
      const otherFile = await createAvailableFile(
        runtimePrisma,
        ownerContext,
        storage,
        "other-driver.pdf",
        new TextEncoder().encode("%PDF-1.7"),
      );
      await attachDocumentFile(runtimePrisma, ownerContext, otherPendingDocument.id, otherFile.id);
      const otherLicence = await addDriverLicence(
        runtimePrisma,
        ownerContext,
        crypto,
        otherDriver.id,
        { licenceNumber: "OTHER-SCOPE-0001", expiresOn: "2030-12-31" },
      );
      const otherLicenceFile = await createAvailableFile(
        runtimePrisma,
        ownerContext,
        storage,
        "other-licence.pdf",
        new TextEncoder().encode("%PDF-1.7"),
      );
      const vehicleSelfType = await createDocumentType(runtimePrisma, ownerContext, {
        code: "SELF_SCOPE_VEHICLE",
        name: "Self scope vehicle",
        subjectType: "VEHICLE",
        evidenceSourceType: "DOCUMENT",
      });
      const companySelfType = await createDocumentType(runtimePrisma, ownerContext, {
        code: "SELF_SCOPE_COMPANY",
        name: "Self scope company",
        subjectType: "COMPANY",
        evidenceSourceType: "DOCUMENT",
      });
      const [
        otherMetadataDenied,
        otherBinaryDenied,
        otherLicenceDenied,
        vehicleDenied,
        companyDenied,
        reviewDenied,
        revokeDenied,
      ] = await Promise.all([
        rejects(() =>
          updatePendingDocument(runtimePrisma!, selfContext, otherPendingDocument.id, {
            validFrom: "2026-01-01",
          }),
        ),
        rejects(() => createStoredFileDownload(runtimePrisma!, selfContext, storage, otherFile.id)),
        rejects(() =>
          attachDriverLicenceFile(
            runtimePrisma!,
            selfContext,
            otherLicence.id,
            otherLicenceFile.id,
            "COMBINED",
          ),
        ),
        rejects(() =>
          createDocument(runtimePrisma!, selfContext, {
            documentTypeId: vehicleSelfType.id,
            subjectType: "VEHICLE",
          }),
        ),
        rejects(() =>
          createDocument(runtimePrisma!, selfContext, {
            documentTypeId: companySelfType.id,
            subjectType: "COMPANY",
          }),
        ),
        rejects(() =>
          reviewDocument(runtimePrisma!, selfContext, ownPendingDocument.id, "APPROVED"),
        ),
        rejects(() =>
          revokeDocument(runtimePrisma!, selfContext, ownPendingDocument.id, "not allowed"),
        ),
      ]);
      checkpoint(
        "phase3b2_driver_self_scope_document_file_and_licence",
        ownDownload.filename === "self-scope.pdf" &&
          otherMetadataDenied &&
          otherBinaryDenied &&
          otherLicenceDenied &&
          vehicleDenied &&
          companyDenied &&
          reviewDenied &&
          revokeDenied,
      );

      // Force the final Activity insert to fail after Document and review history writes.
      const rollbackDocument = await createDocument(runtimePrisma, ownerContext, {
        documentTypeId: selfType.id,
        subjectType: "DRIVER",
        driverId: selfDriver.id,
      });
      const rollbackFile = await createAvailableFile(
        runtimePrisma,
        ownerContext,
        storage,
        "rollback.pdf",
        new TextEncoder().encode("%PDF-1.7"),
      );
      await attachDocumentFile(runtimePrisma, ownerContext, rollbackDocument.id, rollbackFile.id);
      let forcedAuditFailure = false;
      await targetAdmin.query(`REVOKE INSERT ON activities FROM ${quote(runtimeRole)}`);
      try {
        await reviewDocument(runtimePrisma, reviewerContext, rollbackDocument.id, "APPROVED");
      } catch {
        forcedAuditFailure = true;
      } finally {
        await targetAdmin.query(`GRANT INSERT ON activities TO ${quote(runtimeRole)}`);
      }
      const rollbackState = await withTenantTransaction(runtimePrisma, ownerContext, async (tx) => {
        const [documentState, historyCount, activityCount] = await Promise.all([
          tx.document.findUnique({
            where: { companyId_id: { companyId, id: rollbackDocument.id } },
            select: { reviewStatus: true },
          }),
          tx.documentReviewHistory.count({ where: { companyId, documentId: rollbackDocument.id } }),
          tx.activity.count({
            where: { companyId, entityId: rollbackDocument.id, action: "document.approved" },
          }),
        ]);
        return { documentState, historyCount, activityCount };
      });
      checkpoint(
        "phase3b2_review_audit_failure_rolls_back_atomically",
        forcedAuditFailure &&
          rollbackState.documentState?.reviewStatus === "PENDING_REVIEW" &&
          rollbackState.historyCount === 0 &&
          rollbackState.activityCount === 0,
      );

      // A separate tenant keeps the aggregate denominator assertions independent.
      const aggregateCompanyId = randomUUID();
      await targetAdmin.query(
        "INSERT INTO companies(id,name,slug,status,updated_at) VALUES ($1,'Aggregate fixture','phase3b2-aggregate','ACTIVE',now())",
        [aggregateCompanyId],
      );
      await targetAdmin.query(
        "INSERT INTO company_memberships(company_id,user_id,role_id,status,updated_at) VALUES ($1,$2,$3,'ACTIVE',now()),($1,$4,$5,'ACTIVE',now())",
        [aggregateCompanyId, owner, ownerRole, reviewer, adminRole],
      );
      const aggregateOwnerContext = await resolveTenantContext(
        runtimePrisma,
        { userId: owner },
        aggregateCompanyId,
      );
      const aggregateReviewerContext = await resolveTenantContext(
        runtimePrisma,
        { userId: reviewer },
        aggregateCompanyId,
      );
      const aggregateCompliantDriver = await createDriver(runtimePrisma, aggregateOwnerContext, {
        displayName: "Aggregate compliant driver",
      });
      const aggregateAtRiskDriver = await createDriver(runtimePrisma, aggregateOwnerContext, {
        displayName: "Aggregate at-risk driver",
      });
      const aggregateMissingDriver = await createDriver(runtimePrisma, aggregateOwnerContext, {
        displayName: "Aggregate missing driver",
      });
      const aggregateCategory = (
        await targetAdmin.query(
          "INSERT INTO vehicle_categories(company_id,code,name) VALUES ($1,'AGGREGATE','Aggregate') RETURNING id",
          [aggregateCompanyId],
        )
      ).rows[0].id as string;
      const aggregateVehicle = (
        await targetAdmin.query(
          "INSERT INTO vehicles(company_id,registration_display,registration_normalized,vehicle_category_id,updated_at) VALUES ($1,'AGG-001','AGG001',$2,now()) RETURNING id",
          [aggregateCompanyId, aggregateCategory],
        )
      ).rows[0].id as string;
      const aggregateDriverType = await createDocumentType(runtimePrisma, aggregateOwnerContext, {
        code: "AGGREGATE_DRIVER",
        name: "Aggregate driver document",
        subjectType: "DRIVER",
        evidenceSourceType: "DOCUMENT",
        requiresExpiryDate: true,
      });
      await createComplianceRequirement(runtimePrisma, aggregateOwnerContext, {
        documentTypeId: aggregateDriverType.id,
        subjectType: "DRIVER",
        applicability: "GLOBAL",
        name: "Aggregate driver requirement",
        expiryWarningDays: 30,
      });
      const preAggregate = await evaluateCompanyCompliance(
        runtimePrisma,
        aggregateOwnerContext,
        new Date("2026-01-01"),
      );
      const aggregateDocument = async (driverId: string, expiryDate: string, filename: string) => {
        const item = await createDocument(runtimePrisma!, aggregateOwnerContext, {
          documentTypeId: aggregateDriverType.id,
          subjectType: "DRIVER",
          driverId,
          expiryDate,
        });
        const file = await createAvailableFile(
          runtimePrisma!,
          aggregateOwnerContext,
          storage,
          filename,
          new TextEncoder().encode("%PDF-1.7"),
        );
        await attachDocumentFile(runtimePrisma!, aggregateOwnerContext, item.id, file.id);
        await reviewDocument(runtimePrisma!, aggregateReviewerContext, item.id, "APPROVED");
      };
      await aggregateDocument(aggregateCompliantDriver.id, "2030-01-01", "aggregate-good.pdf");
      await aggregateDocument(aggregateAtRiskDriver.id, "2026-01-15", "aggregate-risk.pdf");
      await createDocument(runtimePrisma, aggregateOwnerContext, {
        documentTypeId: aggregateDriverType.id,
        subjectType: "DRIVER",
        driverId: aggregateMissingDriver.id,
        expiryDate: "2030-01-01",
      });
      const aggregateVehicleType = await createDocumentType(runtimePrisma, aggregateOwnerContext, {
        code: "AGGREGATE_VEHICLE",
        name: "Aggregate vehicle document",
        subjectType: "VEHICLE",
        evidenceSourceType: "DOCUMENT",
      });
      await createComplianceRequirement(runtimePrisma, aggregateOwnerContext, {
        documentTypeId: aggregateVehicleType.id,
        subjectType: "VEHICLE",
        applicability: "GLOBAL",
        name: "Aggregate vehicle requirement",
      });
      const aggregateCompanyType = await createDocumentType(runtimePrisma, aggregateOwnerContext, {
        code: "AGGREGATE_COMPANY",
        name: "Aggregate company document",
        subjectType: "COMPANY",
        evidenceSourceType: "DOCUMENT",
      });
      const aggregateCompanyRequirement = await createComplianceRequirement(
        runtimePrisma,
        aggregateOwnerContext,
        {
          documentTypeId: aggregateCompanyType.id,
          subjectType: "COMPANY",
          applicability: "GLOBAL",
          name: "Aggregate company requirement",
        },
      );
      await grantRequirementExemption(runtimePrisma, aggregateOwnerContext, {
        requirementId: aggregateCompanyRequirement.id,
        subjectType: "COMPANY",
        reason: "Open-ended aggregate exemption",
      });
      const aggregateEvaluation = await evaluateCompanyCompliance(
        runtimePrisma,
        aggregateOwnerContext,
        new Date("2026-01-01"),
      );
      const aggregateSummary = (subjectType: "DRIVER" | "VEHICLE" | "COMPANY", subjectId: string) =>
        aggregateEvaluation.subjectSummaries.find(
          (summary) => summary.subjectType === subjectType && summary.subjectId === subjectId,
        );
      checkpoint(
        "phase3b2_compliance_subject_summaries_and_aggregates",
        preAggregate.subjectSummaries.some(
          (summary) =>
            summary.subjectType === "VEHICLE" &&
            summary.subjectId === aggregateVehicle &&
            summary.status === "NOT_EVALUATED" &&
            summary.percentage === null,
        ) &&
          aggregateSummary("DRIVER", aggregateCompliantDriver.id)?.status === "COMPLIANT" &&
          aggregateSummary("DRIVER", aggregateAtRiskDriver.id)?.status === "AT_RISK" &&
          aggregateSummary("DRIVER", aggregateMissingDriver.id)?.status === "NON_COMPLIANT" &&
          aggregateSummary("VEHICLE", aggregateVehicle)?.status === "NON_COMPLIANT" &&
          aggregateSummary("COMPANY", aggregateCompanyId)?.status === "NOT_EVALUATED" &&
          aggregateEvaluation.aggregates.DRIVER.applicableObligationCount === 3 &&
          aggregateEvaluation.aggregates.DRIVER.pendingReviewCount === 1 &&
          aggregateEvaluation.aggregates.DRIVER.activeExemptionCount === 0 &&
          aggregateEvaluation.aggregates.VEHICLE.applicableObligationCount === 1 &&
          aggregateEvaluation.aggregates.VEHICLE.activeExemptionCount === 0 &&
          aggregateEvaluation.aggregates.COMPANY.applicableObligationCount === 0 &&
          aggregateEvaluation.aggregates.COMPANY.percentage === null &&
          aggregateEvaluation.aggregates.COMPANY.activeExemptionCount === 1 &&
          aggregateEvaluation.aggregates.OVERALL.applicableObligationCount === 4 &&
          aggregateEvaluation.aggregates.OVERALL.compliantOrAtRiskCount === 2 &&
          aggregateEvaluation.aggregates.OVERALL.percentage === 50 &&
          aggregateEvaluation.aggregates.OVERALL.activeExemptionCount === 1 &&
          aggregateEvaluation.aggregates.OVERALL.pendingReviewCount === 1,
      );

      const noContext = await runtimePrisma.$transaction((tx) => tx.documentType.count());
      checkpoint("phase3b2_no_context_fail_closed", noContext === 0);
      const reviewHistory = await withTenantTransaction(runtimePrisma, reviewerContext, (tx) =>
        tx.documentReviewHistory.count({ where: { documentId: document.id } }),
      );
      checkpoint("phase3b2_review_history_and_audit", reviewHistory === 1);
    } finally {
      await runtimePrisma?.$disconnect();
      await targetAdmin.end();
    }
  } finally {
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${quote(databaseName)} WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS ${quote(runtimeRole)}`);
      await admin.query(`DROP ROLE IF EXISTS ${quote(migratorRole)}`);
    } finally {
      await admin.end();
    }
  }
}

const runsAsEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (process.env.OIS_PHASE3B2_POSTGRES_IMPORT_SMOKE === "true") {
  console.log("phase3b2_postgres_acceptance_import_smoke: PASS");
} else if (runsAsEntrypoint) {
  runPhase3b2PostgresAcceptance().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
