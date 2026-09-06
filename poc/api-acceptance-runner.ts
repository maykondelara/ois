/* eslint-disable no-unused-vars */
import { randomBytes } from "node:crypto";
import type { Client } from "pg";
import { hashPassword } from "../src/modules/identity/password.service";
import { startApiAcceptanceServer } from "./api-acceptance-server";
import { createPhase3a3CheckpointLedger } from "./phase3a3-api-acceptance-checkpoints";

type JsonRecord = Record<string, unknown>;
type CookieJar = Map<string, string>;
type ApiResponse = Readonly<{
  status: number;
  body: unknown;
  requestId: string | null;
}>;

export type ApiAcceptanceInput = Readonly<{
  admin: Client;
  runtimeDatabaseUrl: string;
  checkpoint: (name: string, passed: boolean) => void;
}>;

const acceptancePrefix = `api-${randomBytes(8).toString("hex")}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(value: unknown): JsonRecord {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "Expected JSON object",
  );
  return value as JsonRecord;
}

function array(value: unknown): unknown[] {
  assert(Array.isArray(value), "Expected JSON array");
  return value;
}

function string(value: unknown, field: string): string {
  assert(typeof value === "string", `Expected string ${field}`);
  return value;
}

function number(value: unknown, field: string): number {
  assert(typeof value === "number", `Expected number ${field}`);
  return value;
}

function data(response: ApiResponse): JsonRecord {
  return record(record(response.body).data);
}

function dataArray(response: ApiResponse): unknown[] {
  return array(record(response.body).data);
}

function error(response: ApiResponse): JsonRecord {
  return record(record(response.body).error);
}

function newJar(): CookieJar {
  return new Map();
}

function setCookies(headers: Headers, jar: CookieJar) {
  const values = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const value of values) {
    const first = value.split(";", 1)[0];
    if (!first) continue;
    const separator = first.indexOf("=");
    if (separator <= 0) continue;
    jar.set(first.slice(0, separator), first.slice(separator + 1));
  }
}

function cookieHeader(jar: CookieJar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function parseResponse(response: Response, jar: CookieJar): Promise<ApiResponse> {
  setCookies(response.headers, jar);
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new Error("API returned non-JSON content");
    }
  }
  return { status: response.status, body, requestId: response.headers.get("x-request-id") };
}

type RequestOptions = Readonly<{
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  rawBody?: string;
  origin?: "matching" | "missing" | "mismatched";
  contentType?: string | null;
  requestId?: string;
}>;

async function apiRequest(
  baseUrl: string,
  jar: CookieJar,
  path: string,
  options: RequestOptions = {},
): Promise<ApiResponse> {
  const method = options.method ?? "GET";
  const unsafe = !["GET", "HEAD", "OPTIONS"].includes(method);
  const headers = new Headers({ accept: "application/json" });
  const cookie = cookieHeader(jar);
  if (cookie) headers.set("cookie", cookie);
  if (unsafe) {
    if (options.origin !== "missing")
      headers.set(
        "origin",
        options.origin === "mismatched" ? "https://invalid-origin.test" : baseUrl,
      );
    const contentType =
      options.contentType === undefined ? "application/json" : options.contentType;
    if (contentType) headers.set("content-type", contentType);
  }
  if (options.requestId) headers.set("x-request-id", options.requestId);
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    redirect: "manual",
    ...(options.rawBody === undefined && options.body === undefined
      ? {}
      : { body: options.rawBody ?? JSON.stringify(options.body) }),
  });
  return parseResponse(response, jar);
}

function assertError(response: ApiResponse, status: number, code: string) {
  assert(response.status === status, `Expected HTTP ${status}`);
  const payload = error(response);
  assert(payload.code === code, `Expected error code ${code}`);
  assert(
    typeof payload.requestId === "string" && payload.requestId.length > 0,
    "Missing request ID",
  );
  assert(typeof payload.message === "string" && payload.message.length > 0, "Missing safe message");
  assert(response.requestId === payload.requestId, "Error request ID header and body must agree");
}

async function signIn(baseUrl: string, email: string, password: string): Promise<CookieJar | null> {
  const jar = newJar();
  const csrf = await parseResponse(
    await fetch(`${baseUrl}/api/auth/csrf`, { redirect: "manual" }),
    jar,
  );
  if (csrf.status !== 200) return null;
  const csrfToken = string(record(csrf.body).csrfToken, "csrfToken");
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
  const cookie = cookieHeader(jar);
  if (cookie) headers.set("cookie", cookie);
  const callback = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: "POST",
    headers,
    redirect: "manual",
    body: new URLSearchParams({
      csrfToken,
      email,
      password,
      callbackUrl: baseUrl,
      json: "true",
    }),
  });
  setCookies(callback.headers, jar);
  const session = await apiRequest(baseUrl, jar, "/api/auth/session");
  return record(session.body).user ? jar : null;
}

async function createFixtures(admin: Client) {
  const ownerPassword = randomBytes(24).toString("base64url");
  const driverPassword = randomBytes(24).toString("base64url");
  const inactivePassword = randomBytes(24).toString("base64url");
  const suspendedPassword = randomBytes(24).toString("base64url");
  const [ownerHash, driverHash, inactiveHash, suspendedHash] = await Promise.all([
    hashPassword(ownerPassword),
    hashPassword(driverPassword),
    hashPassword(inactivePassword),
    hashPassword(suspendedPassword),
  ]);
  const users = await admin.query(
    "INSERT INTO users(email,password_hash,account_status,updated_at) VALUES ($1,$2,'ACTIVE',now()),($3,$4,'ACTIVE',now()),($5,$6,'ACTIVE',now()),($7,$8,'SUSPENDED',now()),($9,$2,'ACTIVE',now()) RETURNING id,email",
    [
      `${acceptancePrefix}-owner-a@test.invalid`,
      ownerHash,
      `${acceptancePrefix}-driver-a@test.invalid`,
      driverHash,
      `${acceptancePrefix}-inactive@test.invalid`,
      inactiveHash,
      `${acceptancePrefix}-suspended@test.invalid`,
      suspendedHash,
      `${acceptancePrefix}-owner-b@test.invalid`,
    ],
  );
  const user = (suffix: string) =>
    string(users.rows.find((row) => String(row.email).includes(suffix))?.id, "fixture user id");
  const ownerAId = user("owner-a");
  const driverAId = user("driver-a");
  const inactiveId = user("inactive");
  const suspendedId = user("suspended");
  const ownerBId = user("owner-b");
  const roles = await admin.query("SELECT id,code FROM roles WHERE code = ANY($1::text[])", [
    ["OWNER", "DRIVER"],
  ]);
  const role = (code: string) =>
    string(roles.rows.find((row) => row.code === code)?.id, `${code} role id`);
  const companies = await admin.query(
    "INSERT INTO companies(name,slug,updated_at) VALUES ($1,$2,now()),($3,$4,now()),($5,$6,now()) RETURNING id,slug",
    [
      "API Acceptance A",
      `${acceptancePrefix}-a`,
      "API Acceptance B",
      `${acceptancePrefix}-b`,
      "API Acceptance Inactive",
      `${acceptancePrefix}-inactive`,
    ],
  );
  const company = (suffix: string) =>
    string(
      companies.rows.find((row) => String(row.slug).endsWith(suffix))?.id,
      "fixture company id",
    );
  const companyA = company("-a");
  const companyB = company("-b");
  const inactiveCompany = company("-inactive");
  await admin.query(
    "INSERT INTO company_memberships(company_id,user_id,role_id,status,updated_at) VALUES ($1,$4,$8,'ACTIVE',now()),($1,$5,$9,'ACTIVE',now()),($2,$6,$8,'ACTIVE',now()),($3,$7,$8,'INACTIVE',now())",
    [
      companyA,
      companyB,
      inactiveCompany,
      ownerAId,
      driverAId,
      ownerBId,
      inactiveId,
      role("OWNER"),
      role("DRIVER"),
    ],
  );
  return {
    companyA,
    companyB,
    inactiveCompany,
    ownerA: {
      id: ownerAId,
      email: `${acceptancePrefix}-owner-a@test.invalid`,
      password: ownerPassword,
    },
    ownerB: {
      id: ownerBId,
      email: `${acceptancePrefix}-owner-b@test.invalid`,
      password: ownerPassword,
    },
    driverA: {
      id: driverAId,
      email: `${acceptancePrefix}-driver-a@test.invalid`,
      password: driverPassword,
    },
    inactive: {
      id: inactiveId,
      email: `${acceptancePrefix}-inactive@test.invalid`,
      password: inactivePassword,
    },
    suspended: {
      id: suspendedId,
      email: `${acceptancePrefix}-suspended@test.invalid`,
      password: suspendedPassword,
    },
  };
}

/** Executes real HTTP calls through Next.js, Auth.js, TenantContext, services, RLS, and audit. */
export async function runPhase3a3ApiAcceptance(input: ApiAcceptanceInput) {
  const ledger = createPhase3a3CheckpointLedger(input.checkpoint);
  const checkpoint = ledger.checkpoint;
  const fixtures = await createFixtures(input.admin);
  const server = await startApiAcceptanceServer({ databaseUrl: input.runtimeDatabaseUrl });
  try {
    const ownerA = await signIn(server.baseUrl, fixtures.ownerA.email, fixtures.ownerA.password);
    const ownerB = await signIn(server.baseUrl, fixtures.ownerB.email, fixtures.ownerB.password);
    const driverA = await signIn(server.baseUrl, fixtures.driverA.email, fixtures.driverA.password);
    const inactive = await signIn(
      server.baseUrl,
      fixtures.inactive.email,
      fixtures.inactive.password,
    );
    const suspended = await signIn(
      server.baseUrl,
      fixtures.suspended.email,
      fixtures.suspended.password,
    );
    const invalidCredentials = await signIn(
      server.baseUrl,
      fixtures.ownerA.email,
      `${fixtures.ownerA.password}x`,
    );
    assert(ownerA && ownerB && driverA && inactive, "Expected active fixture sessions");
    const unauthenticated = await apiRequest(
      server.baseUrl,
      newJar(),
      `/api/companies/${fixtures.companyA}/drivers`,
    );
    assertError(unauthenticated, 401, "AUTHENTICATION_REQUIRED");
    assert(
      suspended === null && invalidCredentials === null,
      "Invalid or suspended users must not establish sessions",
    );
    await input.admin.query("UPDATE users SET account_status='SUSPENDED' WHERE id=$1", [
      fixtures.ownerA.id,
    ]);
    const suspendedExistingSession = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/drivers`,
    );
    await input.admin.query("UPDATE users SET account_status='ACTIVE' WHERE id=$1", [
      fixtures.ownerA.id,
    ]);
    assertError(suspendedExistingSession, 401, "AUTHENTICATION_REQUIRED");
    checkpoint("phase3a3_api_authentication", true);

    const activeSettings = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/operational-settings`,
    );
    assert(activeSettings.status === 200, "Active company selection must succeed");
    const foreignSelector = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyB}/operational-settings`,
    );
    const inactiveSelector = await apiRequest(
      server.baseUrl,
      inactive,
      `/api/companies/${fixtures.inactiveCompany}/operational-settings`,
    );
    assertError(foreignSelector, 404, "TENANT_RESOURCE_NOT_FOUND");
    assertError(inactiveSelector, 404, "TENANT_RESOURCE_NOT_FOUND");
    const driverSettingsDenied = await apiRequest(
      server.baseUrl,
      driverA,
      `/api/companies/${fixtures.companyA}/operational-settings`,
    );
    assertError(driverSettingsDenied, 403, "PERMISSION_DENIED");
    checkpoint("phase3a3_api_tenant_selection", true);

    const missingOrigin = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/operational-settings/initialize`,
      { method: "POST", origin: "missing" },
    );
    const mismatchedOrigin = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/operational-settings/initialize`,
      { method: "POST", origin: "mismatched" },
    );
    const invalidContentType = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/operational-settings/initialize`,
      { method: "POST", contentType: "text/plain" },
    );
    assertError(missingOrigin, 403, "PERMISSION_DENIED");
    assertError(mismatchedOrigin, 403, "PERMISSION_DENIED");
    assertError(invalidContentType, 400, "INVALID_CONTENT_TYPE");
    const initializeA = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/operational-settings/initialize`,
      { method: "POST" },
    );
    const initializeB = await apiRequest(
      server.baseUrl,
      ownerB,
      `/api/companies/${fixtures.companyB}/operational-settings/initialize`,
      { method: "POST" },
    );
    assert(initializeA.status === 200 && initializeB.status === 200, "Initialization must succeed");

    const categoriesA = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicle-categories?includeInactive=true`,
    );
    const categoryRows = dataArray(categoriesA).map(record);
    assert(
      ["VAN", "LR", "MR", "HR", "HC", "MC"].every((code) =>
        categoryRows.some((row) => row.code === code),
      ),
      "Expected default vehicle categories",
    );
    const vanId = string(categoryRows.find((row) => row.code === "VAN")?.id, "VAN category id");
    const customCategory = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicle-categories`,
      { method: "POST", body: { code: "API_ACCEPT", name: "API acceptance" } },
    );
    assert(customCategory.status === 201, "Category creation must return 201");
    const customCategoryId = string(data(customCategory).id, "custom category id");
    const updatedCategory = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicle-categories/${customCategoryId}`,
      { method: "PATCH", body: { code: "MUTATED", name: "API acceptance updated" } },
    );
    const deactivatedCategory = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicle-categories/${customCategoryId}`,
      { method: "PATCH", body: { isActive: false } },
    );
    assert(deactivatedCategory.status === 200, "Category deactivation must succeed");
    const reactivatedCategory = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicle-categories/${customCategoryId}`,
      { method: "PATCH", body: { isActive: true } },
    );
    const unauthorizedCategoryCreate = await apiRequest(
      server.baseUrl,
      driverA,
      `/api/companies/${fixtures.companyA}/vehicle-categories`,
      { method: "POST", body: { code: "DENIED", name: "Denied" } },
    );
    const unauthorizedCategoryUpdate = await apiRequest(
      server.baseUrl,
      driverA,
      `/api/companies/${fixtures.companyA}/vehicle-categories/${customCategoryId}`,
      { method: "PATCH", body: { isActive: false } },
    );
    const categoryPayload = JSON.stringify([
      categoriesA.body,
      customCategory.body,
      updatedCategory.body,
      deactivatedCategory.body,
      reactivatedCategory.body,
    ]);
    assert(
      data(updatedCategory).code === "API_ACCEPT" &&
        data(updatedCategory).name === "API acceptance updated" &&
        data(deactivatedCategory).isActive === false &&
        data(reactivatedCategory).isActive === true &&
        !/companyId|createdAt|updatedAt|deletedAt/i.test(categoryPayload),
      "Vehicle-category DTO or immutable-code contract failed",
    );
    assertError(unauthorizedCategoryCreate, 403, "PERMISSION_DENIED");
    assertError(unauthorizedCategoryUpdate, 403, "PERMISSION_DENIED");
    checkpoint("phase3a3_api_vehicle_categories", true);

    const driverCreate = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/drivers`,
      {
        method: "POST",
        body: {
          displayName: "API Linked Driver",
          userId: fixtures.driverA.id,
          // This ignored transport field proves body tenant selection has no authority.
          companyId: fixtures.companyB,
        },
      },
    );
    assert(driverCreate.status === 201, "Driver creation must return 201");
    const linkedDriverId = string(data(driverCreate).id, "driver id");
    const otherDriver = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/drivers`,
      {
        method: "POST",
        body: { displayName: "API Other Driver" },
      },
    );
    const otherDriverId = string(data(otherDriver).id, "other driver id");
    const updatedDriver = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/drivers/${linkedDriverId}`,
      { method: "PATCH", body: { displayName: "API Updated Driver" } },
    );
    const changedStatus = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/drivers/${linkedDriverId}/status`,
      { method: "POST", body: { status: "ON_LEAVE" } },
    );
    assert(
      data(updatedDriver).displayName === "API Updated Driver" &&
        data(changedStatus).operationalStatus === "ON_LEAVE",
      "Driver lifecycle HTTP operations failed",
    );
    const unlinked = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/drivers/${linkedDriverId}/user-link`,
      { method: "PUT", body: { userId: null } },
    );
    const relinked = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/drivers/${linkedDriverId}/user-link`,
      { method: "PUT", body: { userId: fixtures.driverA.id } },
    );
    assert(unlinked.status === 200 && relinked.status === 200, "Driver link lifecycle failed");
    const driverList = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/drivers?page=1&pageSize=1&status=ON_LEAVE&linked=true&q=API`,
    );
    assert(
      dataArray(driverList).length === 1 && record(driverList.body).page !== undefined,
      "Bounded driver pagination failed",
    );
    const invalidPage = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/drivers?pageSize=101`,
    );
    assertError(invalidPage, 400, "INVALID_PAGINATION");
    checkpoint("phase3a3_api_driver_crud", true);

    const ownDriver = await apiRequest(
      server.baseUrl,
      driverA,
      `/api/companies/${fixtures.companyA}/drivers/${linkedDriverId}`,
    );
    const foreignDriverScope = await apiRequest(
      server.baseUrl,
      driverA,
      `/api/companies/${fixtures.companyA}/drivers/${otherDriverId}`,
    );
    const driverManageDenied = await apiRequest(
      server.baseUrl,
      driverA,
      `/api/companies/${fixtures.companyA}/drivers`,
      { method: "POST", body: { displayName: "Denied" } },
    );
    assert(ownDriver.status === 200, "Driver self read must succeed");
    assertError(foreignDriverScope, 403, "PERMISSION_DENIED");
    assertError(driverManageDenied, 403, "PERMISSION_DENIED");
    checkpoint("phase3a3_api_driver_self_read", true);

    const weekdays = Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      isAvailable: dayOfWeek < 5,
    }));
    const availabilityPut = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/drivers/${linkedDriverId}/availability`,
      { method: "PUT", body: weekdays },
    );
    const availabilityGet = await apiRequest(
      server.baseUrl,
      driverA,
      `/api/companies/${fixtures.companyA}/drivers/${linkedDriverId}/availability`,
    );
    assert(
      dataArray(availabilityPut).length === 7 && dataArray(availabilityGet).length === 7,
      "Availability contract failed",
    );
    checkpoint("phase3a3_api_driver_availability", true);

    const capabilityGrant = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/drivers/${linkedDriverId}/vehicle-capabilities`,
      { method: "POST", body: { vehicleCategoryId: vanId } },
    );
    const capabilityList = await apiRequest(
      server.baseUrl,
      driverA,
      `/api/companies/${fixtures.companyA}/drivers/${linkedDriverId}/vehicle-capabilities`,
    );
    const capabilityFilteredDrivers = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/drivers?vehicleCategoryId=${vanId}`,
    );
    const capabilityRevoke = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/drivers/${linkedDriverId}/vehicle-capabilities/${vanId}`,
      { method: "DELETE" },
    );
    assert(
      capabilityGrant.status === 200 &&
        dataArray(capabilityList).length === 1 &&
        capabilityRevoke.status === 200,
      "Driver category capability contract failed",
    );
    assert(
      dataArray(capabilityFilteredDrivers).some((row) => record(row).id === linkedDriverId),
      "Driver category filter failed",
    );
    checkpoint("phase3a3_api_driver_categories", true);

    const licenceValue = `LIC-${randomBytes(8).toString("hex")}`;
    const licence = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/drivers/${linkedDriverId}/licences`,
      { method: "POST", body: { licenceNumber: licenceValue, expiresOn: "2031-01-01" } },
    );
    assert(licence.status === 201, "Licence creation must return 201");
    const licenceId = string(data(licence).id, "licence id");
    const licenceUpdate = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/drivers/${linkedDriverId}/licences/${licenceId}`,
      { method: "PATCH", body: { expiresOn: "2032-01-01" } },
    );
    const licenceList = await apiRequest(
      server.baseUrl,
      driverA,
      `/api/companies/${fixtures.companyA}/drivers/${linkedDriverId}/licences`,
    );
    const licencePayload = JSON.stringify([licence.body, licenceUpdate.body, licenceList.body]);
    assert(
      licenceUpdate.status === 200 &&
        !licencePayload.includes(licenceValue) &&
        !/ciphertext|lookup.?hash|key.?version/i.test(licencePayload),
      "Licence response must remain redacted",
    );
    checkpoint("phase3a3_api_driver_licence_redaction", true);

    const settingsUpdate = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/operational-settings`,
      {
        method: "PATCH",
        body: {
          odometerExpectedIncreaseThresholdKm: 1000,
          inspectionVehicleSelectionStrategy: "BOTH",
        },
      },
    );
    const invalidSettings = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/operational-settings`,
      { method: "PATCH", body: { odometerExpectedIncreaseThresholdKm: 0 } },
    );
    assert(
      settingsUpdate.status === 200 && invalidSettings.status === 400,
      "Settings validation failed",
    );
    checkpoint("phase3a3_api_operational_settings", true);

    const inactiveForVehicleSelection = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicle-categories/${customCategoryId}`,
      { method: "PATCH", body: { isActive: false } },
    );
    assert(data(inactiveForVehicleSelection).isActive === false, "Category must deactivate");
    const inactiveVehicle = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles`,
      {
        method: "POST",
        body: { registration: "API INACTIVE", vehicleCategoryId: customCategoryId },
      },
    );
    assertError(inactiveVehicle, 409, "INACTIVE_VEHICLE_CATEGORY");
    const vehicleCreate = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles`,
      {
        method: "POST",
        body: {
          registration: "API 100",
          vehicleCategoryId: vanId,
          initialOdometerKm: 100000,
          nextServiceOdometerKm: 103000,
        },
      },
    );
    assert(vehicleCreate.status === 201, "Vehicle creation must return 201");
    const vehicleId = string(data(vehicleCreate).id, "vehicle id");
    const duplicateVehicle = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles`,
      {
        method: "POST",
        body: { registration: "API-100", vehicleCategoryId: vanId },
      },
    );
    assertError(duplicateVehicle, 409, "DUPLICATE_REGISTRATION");
    const categoriesB = await apiRequest(
      server.baseUrl,
      ownerB,
      `/api/companies/${fixtures.companyB}/vehicle-categories`,
    );
    const vanB = string(
      dataArray(categoriesB)
        .map(record)
        .find((row) => row.code === "VAN")?.id,
      "B VAN id",
    );
    const vehicleB = await apiRequest(
      server.baseUrl,
      ownerB,
      `/api/companies/${fixtures.companyB}/vehicles`,
      {
        method: "POST",
        body: { registration: "API 100", vehicleCategoryId: vanB },
      },
    );
    const driverB = await apiRequest(
      server.baseUrl,
      ownerB,
      `/api/companies/${fixtures.companyB}/drivers`,
      {
        method: "POST",
        body: { displayName: "API Company B Driver" },
      },
    );
    assert(vehicleB.status === 201, "Same registration must be allowed in Company B");
    const vehicleDetail = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles/${vehicleId}`,
    );
    const vehicleList = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles?page=1&pageSize=1&status=ACTIVE&q=API`,
    );
    const vehiclePatch = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles/${vehicleId}`,
      { method: "PATCH", body: { registration: "API 101" } },
    );
    const nextService = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles/${vehicleId}/next-service-odometer`,
      { method: "PUT", body: { nextServiceOdometerKm: 104000 } },
    );
    assert(
      vehicleDetail.status === 200 &&
        number(data(vehicleDetail).authoritativeOdometerKm, "authoritative odometer") === 100000 &&
        dataArray(vehicleList).length === 1 &&
        vehiclePatch.status === 200 &&
        nextService.status === 200,
      "Vehicle lifecycle HTTP contract failed",
    );
    const categoryFilteredVehicles = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles?vehicleCategoryId=${vanId}`,
    );
    assert(
      dataArray(categoryFilteredVehicles).some((row) => record(row).id === vehicleId),
      "Vehicle category filter failed",
    );
    checkpoint("phase3a3_api_vehicle_crud", true);

    const resolved = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles/resolve-registration?registration=api-101`,
    );
    const unknown = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles/resolve-registration?registration=UNKNOWN`,
    );
    assert(
      resolved.status === 200 && string(data(resolved).id, "resolved id") === vehicleId,
      "Resolve failed",
    );
    assertError(unknown, 404, "TENANT_RECORD_NOT_FOUND");
    checkpoint("phase3a3_api_vehicle_registration_resolution", true);

    const missingOutOfServiceReason = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles/${vehicleId}/status`,
      { method: "POST", body: { status: "OUT_OF_SERVICE" } },
    );
    const outOfService = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles/${vehicleId}/status`,
      { method: "POST", body: { status: "OUT_OF_SERVICE", reason: "Administrative hold" } },
    );
    const missingClearance = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles/${vehicleId}/status`,
      { method: "POST", body: { status: "ACTIVE" } },
    );
    const restored = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles/${vehicleId}/status`,
      { method: "POST", body: { status: "ACTIVE", reason: "Administrative clearance" } },
    );
    assert(
      missingOutOfServiceReason.status === 422 &&
        outOfService.status === 200 &&
        missingClearance.status === 422 &&
        restored.status === 200,
      "Administrative vehicle status contract failed",
    );
    checkpoint("phase3a3_api_vehicle_status", true);

    const normalOdometer = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles/${vehicleId}/odometer-readings`,
      { method: "POST", body: { readingKm: 100500 } },
    );
    const snapshot = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles/${vehicleId}/odometer`,
    );
    assert(
      data(normalOdometer).kind === "ACCEPTED" &&
        number(data(snapshot).authoritativeOdometerKm, "snapshot odometer") === 100500 &&
        number(data(snapshot).kilometresRemaining, "kilometres remaining") === 3500 &&
        !("confirmationToken" in data(normalOdometer)),
      "Normal odometer result contract failed",
    );
    const normalOdometerAudit = await input.admin.query(
      "SELECT count(*)::int AS count FROM activities WHERE company_id=$1 AND action='vehicle.odometer_accepted'",
      [fixtures.companyA],
    );
    assert(
      Number(normalOdometerAudit.rows[0]?.count) >= 1,
      "Normal odometer audit was not written",
    );
    checkpoint("phase3a3_api_odometer_normal", true);

    const readingCountBefore = await input.admin.query(
      "SELECT count(*)::int AS count FROM vehicle_odometer_readings WHERE company_id=$1 AND vehicle_id=$2",
      [fixtures.companyA, vehicleId],
    );
    const anomaly = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles/${vehicleId}/odometer-readings`,
      { method: "POST", body: { readingKm: 102000 } },
    );
    const anomalyData = data(anomaly);
    const confirmationToken = string(anomalyData.confirmationToken, "opaque confirmation token");
    const readingCountAfterPreview = await input.admin.query(
      "SELECT count(*)::int AS count FROM vehicle_odometer_readings WHERE company_id=$1 AND vehicle_id=$2",
      [fixtures.companyA, vehicleId],
    );
    const tamperedConfirmation = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles/${vehicleId}/odometer-readings`,
      { method: "POST", body: { readingKm: 102000, confirmationToken: `${confirmationToken}x` } },
    );
    const confirmed = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles/${vehicleId}/odometer-readings`,
      { method: "POST", body: { readingKm: 102000, confirmationToken } },
    );
    assert(
      anomalyData.kind === "ANOMALY_CONFIRMATION_REQUIRED" &&
        Number(readingCountBefore.rows[0]?.count) ===
          Number(readingCountAfterPreview.rows[0]?.count) &&
        tamperedConfirmation.status === 422 &&
        data(confirmed).kind === "REVIEW_REQUIRED",
      "Anomaly preview/confirmation contract failed",
    );
    checkpoint("phase3a3_api_odometer_anomaly", true);

    const pendingReadingId = string(data(confirmed).readingId, "pending reading id");
    const driverReviewDenied = await apiRequest(
      server.baseUrl,
      driverA,
      `/api/companies/${fixtures.companyA}/vehicles/${vehicleId}/odometer-readings/${pendingReadingId}/review`,
      { method: "POST", body: { decision: "ACCEPT", reviewNote: "Denied" } },
    );
    const acceptedReview = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles/${vehicleId}/odometer-readings/${pendingReadingId}/review`,
      { method: "POST", body: { decision: "ACCEPT", reviewNote: "Administrative acceptance" } },
    );
    const alreadyReviewed = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles/${vehicleId}/odometer-readings/${pendingReadingId}/review`,
      { method: "POST", body: { decision: "REJECT", reviewNote: "Already handled" } },
    );
    assert(
      driverReviewDenied.status === 403 &&
        data(acceptedReview).status === "ACCEPTED" &&
        alreadyReviewed.status === 409,
      "Odometer review contract failed",
    );
    checkpoint("phase3a3_api_odometer_review", true);

    const malformedJson = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/drivers`,
      {
        method: "POST",
        rawBody: "{",
      },
    );
    const oversized = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/drivers`,
      {
        method: "POST",
        rawBody: JSON.stringify({ displayName: "x".repeat(65 * 1024) }),
      },
    );
    const regression = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles/${vehicleId}/odometer-readings`,
      { method: "POST", body: { readingKm: 1 } },
    );
    assertError(malformedJson, 400, "INVALID_JSON");
    assertError(oversized, 413, "REQUEST_BODY_TOO_LARGE");
    assertError(regression, 422, "ODOMETER_REGRESSION");
    checkpoint("phase3a3_api_authorization", true);
    assertError(unauthenticated, 401, "AUTHENTICATION_REQUIRED");
    assertError(driverSettingsDenied, 403, "PERMISSION_DENIED");
    assertError(unknown, 404, "TENANT_RECORD_NOT_FOUND");
    assertError(duplicateVehicle, 409, "DUPLICATE_REGISTRATION");
    checkpoint("phase3a3_api_error_mapping", true);

    const foreignVehicleId = string(data(vehicleB).id, "foreign vehicle id");
    const foreignDriverId = string(data(driverB).id, "foreign driver id");
    const foreignDriver = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/drivers/${foreignDriverId}`,
    );
    const foreignVehicle = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/vehicles/${foreignVehicleId}`,
    );
    assertError(foreignDriver, 404, "TENANT_RECORD_NOT_FOUND");
    assertError(foreignVehicle, 404, "TENANT_RECORD_NOT_FOUND");
    const storedDriver = await input.admin.query(
      "SELECT company_id::text FROM drivers WHERE id=$1",
      [linkedDriverId],
    );
    assert(
      storedDriver.rows[0]?.company_id === fixtures.companyA,
      "Body company selector affected tenant",
    );
    checkpoint("phase3a3_api_cross_tenant_isolation", true);

    const suppliedRequestId = "acceptance-request-id";
    const requestIdResponse = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/drivers`,
      { requestId: suppliedRequestId },
    );
    const malformedRequestId = await apiRequest(
      server.baseUrl,
      ownerA,
      `/api/companies/${fixtures.companyA}/drivers`,
      { requestId: "not valid!" },
    );
    assert(
      requestIdResponse.requestId === suppliedRequestId &&
        malformedRequestId.requestId !== "not valid!" &&
        malformedRequestId.requestId !== null,
      "Request ID contract failed",
    );
    const audits = await input.admin.query(
      "SELECT count(*)::int AS count FROM activities WHERE company_id=$1 AND action IN ('driver.created','vehicle.created','vehicle.odometer_accepted')",
      [fixtures.companyA],
    );
    assert(Number(audits.rows[0]?.count) >= 3, "Expected API mutations to audit atomically");
    const logs = server.logs();
    assert(
      ![
        licenceValue,
        confirmationToken,
        fixtures.ownerA.password,
        fixtures.driverA.password,
        input.runtimeDatabaseUrl,
      ].some((secret) => logs.includes(secret)),
      "Sensitive acceptance material appeared in application logs",
    );
    checkpoint("phase3a3_api_observability_redaction", true);
    ledger.assertComplete();
  } finally {
    await server.stop();
  }
}

if (process.env.OIS_API_ACCEPTANCE_IMPORT_SMOKE === "true") {
  console.log("phase3a3_api_acceptance_runner_import_smoke: PASS");
}
