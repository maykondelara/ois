import type { Client } from "pg";
import {
  apiRequest,
  newJar,
  signIn,
  type ApiAcceptanceInput,
  type ApiResponse,
} from "./api-acceptance-runner";
import { startApiAcceptanceServer } from "./api-acceptance-server";
import { createPhase3b3Fixtures } from "./phase3b3-api-acceptance-runner";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function object(value: unknown): Record<string, unknown> {
  assert(value && typeof value === "object", "Expected object");
  return value as Record<string, unknown>;
}
function data(response: ApiResponse) {
  return object(object(response.body).data);
}
function error(response: ApiResponse) {
  return object(object(response.body).error);
}
function checkpoint(emit: ApiAcceptanceInput["checkpoint"], name: string) {
  emit(name, true);
}

export async function runPhase3b4ApiAcceptance(input: ApiAcceptanceInput) {
  const fixture = await createPhase3b3Fixtures(input.admin as Client);
  const server = await startApiAcceptanceServer({
    databaseUrl: input.runtimeDatabaseUrl,
    port: 3104,
    fileStorageAcceptanceFake: true,
  });
  try {
    const owner = await signIn(server.baseUrl, fixture.owner.email, fixture.owner.password);
    const driver = await signIn(server.baseUrl, fixture.driver.email, fixture.driver.password);
    assert(owner && driver, "Expected acceptance sessions");
    const base = `/api/companies/${fixture.companyA}`;
    const driverRecord = await apiRequest(server.baseUrl, owner, `${base}/drivers`, {
      method: "POST",
      body: { displayName: "B4 File Driver" },
    });
    assert(driverRecord.status === 201, "Driver fixture creation failed");
    const driverId = String(data(driverRecord).id);
    const linkedDriver = await apiRequest(
      server.baseUrl,
      owner,
      `${base}/drivers/${driverId}/user-link`,
      { method: "PUT", body: { userId: fixture.driver.id } },
    );
    assert(linkedDriver.status === 200, "Driver fixture link failed");
    const unauthenticated = await apiRequest(server.baseUrl, newJar(), `${base}/files`, {
      method: "POST",
      body: { originalFilename: "unauthenticated.pdf" },
    });
    assert(unauthenticated.status === 401, "Unauthenticated file access was allowed");
    const initiated = await apiRequest(server.baseUrl, owner, `${base}/files`, {
      method: "POST",
      body: { originalFilename: "evidence.pdf" },
    });
    assert(initiated.status === 201, "File initiation failed");
    const init = data(initiated);
    assert(
      typeof init.fileId === "string" && typeof init.uploadUrl === "string",
      "Unsafe initiate response",
    );
    assert(!/bucket|objectKey|provider/i.test(JSON.stringify(init)), "Storage internals leaked");
    checkpoint(input.checkpoint, "phase3b4_api_file_initiate");
    const fileId = String(init.fileId);
    const finalized = await apiRequest(server.baseUrl, owner, `${base}/files/${fileId}/finalize`, {
      method: "POST",
      body: {},
    });
    assert(
      finalized.status === 200 && data(finalized).fileState === "AVAILABLE",
      "File finalization failed",
    );
    checkpoint(input.checkpoint, "phase3b4_api_file_finalize");
    const downloaded = await apiRequest(server.baseUrl, owner, `${base}/files/${fileId}/download`);
    assert(
      downloaded.status === 200 && typeof data(downloaded).downloadUrl === "string",
      "File download failed",
    );
    checkpoint(input.checkpoint, "phase3b4_api_file_download");
    const foreign = await apiRequest(
      server.baseUrl,
      owner,
      `/api/companies/${fixture.companyB}/files/${fileId}/download`,
    );
    assert(
      foreign.status === 404 && error(foreign).code === "TENANT_RESOURCE_NOT_FOUND",
      "Cross-tenant file access leaked",
    );
    checkpoint(input.checkpoint, "phase3b4_api_cross_tenant_isolation");
    const driverFinalize = await apiRequest(
      server.baseUrl,
      driver,
      `${base}/files/${fileId}/finalize`,
      { method: "POST", body: {} },
    );
    assert(driverFinalize.status === 404, "Driver finalized another actor's file");
    const ownInitiated = await apiRequest(server.baseUrl, driver, `${base}/files`, {
      method: "POST",
      body: { originalFilename: "own-evidence.pdf" },
    });
    assert(ownInitiated.status === 201, "Driver own file initiation failed");
    const ownFinalized = await apiRequest(
      server.baseUrl,
      driver,
      `${base}/files/${String(data(ownInitiated).fileId)}/finalize`,
      { method: "POST", body: {} },
    );
    assert(ownFinalized.status === 200, "Driver own file finalization failed");
    checkpoint(input.checkpoint, "phase3b4_api_driver_self_scope");
    checkpoint(input.checkpoint, "phase3b4_api_file_security");
    assert(!server.logs().includes("acceptance.invalid"), "Presigned URL was logged");
    checkpoint(input.checkpoint, "phase3b4_api_storage_redaction");
  } finally {
    await server.stop();
  }
}

if (process.env.OIS_PHASE3B4_API_ACCEPTANCE_IMPORT_SMOKE === "true")
  console.log("phase3b4_api_acceptance_runner_import_smoke: PASS");
