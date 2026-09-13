import { randomBytes } from "node:crypto";
import type { Client } from "pg";
import { hashPassword } from "../src/modules/identity/password.service";
import {
  apiRequest,
  newJar,
  signIn,
  type ApiAcceptanceInput,
  type ApiResponse,
} from "./api-acceptance-runner";
import { startApiAcceptanceServer } from "./api-acceptance-server";
import { createPhase3b3CheckpointLedger } from "./phase3b3-api-acceptance-checkpoints";

const prefix = `phase3b3-${randomBytes(8).toString("hex")}`;

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function object(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), "Expected object");
  return value as Record<string, unknown>;
}

function payload(response: ApiResponse) {
  return object(object(response.body).data);
}

function assertError(response: ApiResponse, status: number, code: string) {
  assert(response.status === status, `Expected ${status}, got ${response.status}`);
  const error = object(object(response.body).error);
  assert(error.code === code, `Expected ${code}`);
  assert(typeof error.requestId === "string" && error.requestId.length > 0, "Missing request ID");
}

export async function createPhase3b3Fixtures(
  admin: Client,
  fixturePrefix = `phase3b3-${randomBytes(8).toString("hex")}`,
) {
  // Each acceptance stage receives distinct rows even when this helper is reused
  // by a later stage in the same migration-runner process.
  const prefix = fixturePrefix;
  const password = randomBytes(24).toString("base64url");
  const hash = await hashPassword(password);
  const users = await admin.query(
    "INSERT INTO users(email,password_hash,account_status,updated_at) VALUES ($1,$2,'ACTIVE',now()),($3,$2,'ACTIVE',now()),($4,$2,'ACTIVE',now()) RETURNING id,email",
    [
      `${prefix}-owner@test.invalid`,
      hash,
      `${prefix}-reviewer@test.invalid`,
      `${prefix}-driver@test.invalid`,
    ],
  );
  const byEmail = (fragment: string) =>
    String(users.rows.find((row) => String(row.email).includes(fragment))?.id);
  const owner = byEmail("owner@");
  const reviewer = byEmail("reviewer@");
  const driver = byEmail("driver@");
  const companies = await admin.query(
    "INSERT INTO companies(name,slug,timezone,updated_at) VALUES ($1,$2,'Australia/Perth',now()),($3,$4,'Australia/Perth',now()) RETURNING id,slug",
    ["Phase 3B.3 A", `${prefix}-a`, "Phase 3B.3 B", `${prefix}-b`],
  );
  const companyA = String(companies.rows.find((row) => String(row.slug).endsWith("-a"))?.id);
  const companyB = String(companies.rows.find((row) => String(row.slug).endsWith("-b"))?.id);
  const roles = await admin.query("SELECT id,code FROM roles WHERE code = ANY($1::text[])", [
    ["OWNER", "DRIVER"],
  ]);
  const role = (code: string) => String(roles.rows.find((row) => row.code === code)?.id);
  await admin.query(
    "INSERT INTO company_memberships(company_id,user_id,role_id,status,updated_at) VALUES ($1,$2,$5,'ACTIVE',now()),($1,$3,$5,'ACTIVE',now()),($1,$4,$6,'ACTIVE',now())",
    [companyA, owner, reviewer, driver, role("OWNER"), role("DRIVER")],
  );
  return {
    companyA,
    companyB,
    owner: { email: `${prefix}-owner@test.invalid`, password },
    reviewer: { email: `${prefix}-reviewer@test.invalid`, password },
    driver: { id: driver, email: `${prefix}-driver@test.invalid`, password },
  };
}

/** Real Next.js/Auth.js HTTP acceptance for the non-transport Phase 3B.3 surface. */
export async function runPhase3b3ApiAcceptance(input: ApiAcceptanceInput) {
  const ledger = createPhase3b3CheckpointLedger(input.checkpoint);
  const checkpoint = ledger.checkpoint;
  const fixture = await createPhase3b3Fixtures(input.admin, prefix);
  const server = await startApiAcceptanceServer({
    databaseUrl: input.runtimeDatabaseUrl,
    port: 3_101,
  });
  try {
    const owner = await signIn(server.baseUrl, fixture.owner.email, fixture.owner.password);
    const reviewer = await signIn(
      server.baseUrl,
      fixture.reviewer.email,
      fixture.reviewer.password,
    );
    const driverJar = await signIn(server.baseUrl, fixture.driver.email, fixture.driver.password);
    assert(owner && reviewer && driverJar, "Expected active HTTP sessions");
    const base = `/api/companies/${fixture.companyA}`;
    const unauthenticated = await apiRequest(server.baseUrl, newJar(), `${base}/documents`);
    assertError(unauthenticated, 401, "AUTHENTICATION_REQUIRED");
    checkpoint("phase3b3_api_authentication", true);

    const foreign = await apiRequest(
      server.baseUrl,
      owner,
      `/api/companies/${fixture.companyB}/documents`,
    );
    assertError(foreign, 404, "TENANT_RESOURCE_NOT_FOUND");
    checkpoint("phase3b3_api_tenant_selection", true);

    const typeResponse = await apiRequest(server.baseUrl, owner, `${base}/document-types`, {
      method: "POST",
      body: {
        code: "B3_DRIVER_EVIDENCE",
        name: "B3 Driver evidence",
        subjectType: "DRIVER",
        evidenceSourceType: "DOCUMENT",
      },
    });
    assert(typeResponse.status === 201, "Document type creation failed");
    const documentTypeId = String(payload(typeResponse).id);
    const typeList = await apiRequest(
      server.baseUrl,
      owner,
      `${base}/document-types?page=1&pageSize=25&subjectType=DRIVER`,
    );
    assert(
      typeList.status === 200 && Array.isArray(object(typeList.body).data),
      "Document type list failed",
    );
    const immutable = await apiRequest(
      server.baseUrl,
      owner,
      `${base}/document-types/${documentTypeId}`,
      { method: "PATCH", body: { code: "NO" } },
    );
    assertError(immutable, 400, "INVALID_REQUEST");
    checkpoint("phase3b3_api_document_types", true);

    const driverResponse = await apiRequest(server.baseUrl, owner, `${base}/drivers`, {
      method: "POST",
      body: { displayName: "B3 Driver" },
    });
    assert(driverResponse.status === 201, "Driver fixture creation failed");
    const driverId = String(payload(driverResponse).id);
    const linked = await apiRequest(
      server.baseUrl,
      owner,
      `${base}/drivers/${driverId}/user-link`,
      { method: "PUT", body: { userId: fixture.driver.id } },
    );
    assert(linked.status === 200, "Driver fixture link failed");

    const requirementResponse = await apiRequest(
      server.baseUrl,
      owner,
      `${base}/compliance/requirements`,
      {
        method: "POST",
        body: {
          documentTypeId,
          subjectType: "DRIVER",
          applicability: "SPECIFIC",
          name: "B3 requirement",
          expiryWarningDays: 30,
        },
      },
    );
    assert(requirementResponse.status === 201, "Requirement creation failed");
    const requirementId = String(payload(requirementResponse).id);
    const requirements = await apiRequest(
      server.baseUrl,
      owner,
      `${base}/compliance/requirements?applicability=SPECIFIC`,
    );
    assert(requirements.status === 200, "Requirement list failed");
    const changeMissingReason = await apiRequest(
      server.baseUrl,
      owner,
      `${base}/compliance/requirements/${requirementId}/change-applicability`,
      { method: "POST", body: { applicability: "GLOBAL", reason: "" } },
    );
    assertError(changeMissingReason, 400, "INVALID_REQUEST");
    checkpoint("phase3b3_api_requirements", true);

    const assignment = await apiRequest(
      server.baseUrl,
      owner,
      `${base}/compliance/requirements/${requirementId}/assignments`,
      { method: "POST", body: { subjectType: "DRIVER", driverId } },
    );
    assert(assignment.status === 201, "Assignment creation failed");
    const assignmentId = String(payload(assignment).id);
    const removed = await apiRequest(
      server.baseUrl,
      owner,
      `${base}/compliance/requirements/${requirementId}/assignments/${assignmentId}`,
      { method: "DELETE", body: { reason: "No longer applies" } },
    );
    assert(
      removed.status === 200 && payload(removed).removedAt !== null,
      "Assignment lifecycle removal failed",
    );
    checkpoint("phase3b3_api_assignments", true);

    const exemption = await apiRequest(
      server.baseUrl,
      owner,
      `${base}/compliance/requirements/${requirementId}/exemptions`,
      {
        method: "POST",
        body: {
          subjectType: "DRIVER",
          driverId,
          reason: "Temporary exception",
          effectiveFrom: null,
          expiresOn: null,
        },
      },
    );
    assert(exemption.status === 201, "Open-bound exemption creation failed");
    const exemptionId = String(payload(exemption).id);
    const revoked = await apiRequest(
      server.baseUrl,
      owner,
      `${base}/compliance/requirements/${requirementId}/exemptions/${exemptionId}/revoke`,
      { method: "POST", body: { reason: "Withdrawn" } },
    );
    assert(revoked.status === 200, "Exemption revoke failed");
    checkpoint("phase3b3_api_exemptions", true);

    const document = await apiRequest(server.baseUrl, owner, `${base}/documents`, {
      method: "POST",
      body: { documentTypeId, subjectType: "DRIVER", driverId, expiryDate: "2030-01-01" },
    });
    assert(document.status === 201, "Document creation failed");
    const documentId = String(payload(document).id);
    const correction = await apiRequest(server.baseUrl, owner, `${base}/documents/${documentId}`, {
      method: "PATCH",
      body: { expiryDate: "2030-02-01" },
    });
    assert(correction.status === 200, "Pending document correction failed");
    checkpoint("phase3b3_api_documents", true);

    const file = await input.admin.query(
      "INSERT INTO stored_files(company_id,storage_provider,bucket,object_key,original_filename,mime_type,size_bytes,sha256,file_state,created_by_user_id,updated_at) VALUES ($1,'acceptance','private',$2,'evidence.pdf','application/pdf',4,decode('0000000000000000000000000000000000000000000000000000000000000000','hex'),'AVAILABLE',$3,now()) RETURNING id",
      [fixture.companyA, `${prefix}/evidence.pdf`, fixture.driver.id],
    );
    const storedFileId = String(file.rows[0]?.id);
    const attached = await apiRequest(
      server.baseUrl,
      owner,
      `${base}/documents/${documentId}/files`,
      { method: "POST", body: { storedFileId } },
    );
    assert(
      attached.status === 201 &&
        !JSON.stringify(attached.body).match(/bucket|objectKey|storageProvider/i),
      "Document file DTO leaked storage data",
    );
    checkpoint("phase3b3_api_document_files", true);

    const licence = await apiRequest(
      server.baseUrl,
      owner,
      `${base}/drivers/${driverId}/licences`,
      {
        method: "POST",
        body: { licenceNumber: `${prefix}-licence`, expiresOn: "2030-12-31" },
      },
    );
    assert(licence.status === 201, "Driver licence fixture creation failed");
    const licenceId = String(payload(licence).id);
    const licenceFile = await input.admin.query(
      "INSERT INTO stored_files(company_id,storage_provider,bucket,object_key,original_filename,mime_type,size_bytes,sha256,file_state,created_by_user_id,updated_at) VALUES ($1,'acceptance','private',$2,'licence.png','image/png',8,decode('0000000000000000000000000000000000000000000000000000000000000000','hex'),'AVAILABLE',$3,now()) RETURNING id",
      [fixture.companyA, `${prefix}/licence.png`, fixture.driver.id],
    );
    const licenceAttachment = await apiRequest(
      server.baseUrl,
      driverJar,
      `${base}/drivers/${driverId}/licences/${licenceId}/files`,
      {
        method: "POST",
        body: { storedFileId: String(licenceFile.rows[0]?.id), role: "FRONT" },
      },
    );
    assert(licenceAttachment.status === 201, "Driver self licence attachment failed");
    checkpoint("phase3b3_api_driver_licence_files", true);

    const approved = await apiRequest(
      server.baseUrl,
      reviewer,
      `${base}/documents/${documentId}/approve`,
      { method: "POST", body: {} },
    );
    assert(approved.status === 200, "Document approval failed");
    const archived = await apiRequest(
      server.baseUrl,
      owner,
      `${base}/documents/${documentId}/archive`,
      { method: "POST", body: {} },
    );
    assert(archived.status === 200, "Document archive failed");
    checkpoint("phase3b3_api_document_review", true);
    checkpoint("phase3b3_api_document_lifecycle", true);

    const ownCompliance = await apiRequest(
      server.baseUrl,
      driverJar,
      `${base}/compliance/drivers/${driverId}`,
    );
    assert(ownCompliance.status === 200, "Driver own compliance failed");
    const vehicleDenied = await apiRequest(server.baseUrl, driverJar, `${base}/compliance/company`);
    assertError(vehicleDenied, 403, "PERMISSION_DENIED");
    checkpoint("phase3b3_api_driver_self_scope", true);
    checkpoint("phase3b3_api_compliance_subjects", true);
    const aggregate = await apiRequest(server.baseUrl, owner, `${base}/compliance/summary`);
    assert(
      aggregate.status === 200 && object(payload(aggregate).aggregates).OVERALL,
      "Compliance summary failed",
    );
    checkpoint("phase3b3_api_compliance_summary", true);

    const crossDocument = await apiRequest(
      server.baseUrl,
      owner,
      `/api/companies/${fixture.companyB}/documents/${documentId}`,
    );
    assertError(crossDocument, 404, "TENANT_RESOURCE_NOT_FOUND");
    checkpoint("phase3b3_api_cross_tenant_isolation", true);
    const malformed = await apiRequest(server.baseUrl, owner, `${base}/documents`, {
      method: "POST",
      rawBody: "{",
    });
    assertError(malformed, 400, "INVALID_JSON");
    checkpoint("phase3b3_api_error_mapping", true);
    assert(!server.logs().includes("evidence.pdf"), "Acceptance server logged file metadata");
    checkpoint("phase3b3_api_observability_redaction", true);
    ledger.assertComplete();
  } finally {
    await server.stop();
  }
}

if (process.env.OIS_PHASE3B3_API_ACCEPTANCE_IMPORT_SMOKE === "true") {
  console.log("phase3b3_api_acceptance_runner_import_smoke: PASS");
}
