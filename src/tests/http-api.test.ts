import { describe, expect, it } from "vitest";
import {
  assertRequestSecurity,
  errorResponse,
  parseOffsetPage,
  parseOptionalBoolean,
  parseOptionalEnum,
  parseOptionalSearch,
  parseOptionalUuid,
  readJson,
} from "@/lib/http/api";
import { licenceDto } from "@/lib/http/dto";
import { ConflictError, TenantRecordNotFoundError, ValidationError } from "@/lib/errors";

describe("Phase 3A.3 HTTP boundary helpers", () => {
  it("enforces bounded offset pagination and narrow approved filters", () => {
    const query = new URLSearchParams({
      page: "2",
      pageSize: "100",
      q: "Driver One",
      linked: "false",
      vehicleCategoryId: "1c6bbbd0-6ec6-4bb1-90b4-78521890d456",
      status: "ACTIVE",
    });
    expect(parseOffsetPage(query)).toEqual({ number: 2, pageSize: 100 });
    expect(parseOptionalSearch(query)).toBe("Driver One");
    expect(parseOptionalBoolean(query, "linked")).toBe(false);
    expect(parseOptionalUuid(query, "vehicleCategoryId")).toBe(query.get("vehicleCategoryId"));
    expect(parseOptionalEnum(query, "status", ["ACTIVE", "INACTIVE"])).toBe("ACTIVE");
    expect(() => parseOffsetPage(new URLSearchParams({ pageSize: "101" }))).toThrow(
      ValidationError,
    );
    expect(() => parseOptionalBoolean(new URLSearchParams({ linked: "yes" }), "linked")).toThrow(
      ValidationError,
    );
  });

  it("requires exact same-origin JSON requests before any mutation service runs", () => {
    const request = new Request("https://ois.test/api/companies/x/drivers", {
      method: "POST",
      headers: { origin: "https://ois.test", "content-type": "application/json; charset=utf-8" },
      body: "{}",
    });
    expect(() => assertRequestSecurity(request)).not.toThrow();
    expect(() =>
      assertRequestSecurity(
        new Request("https://ois.test/api/companies/x/drivers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      ),
    ).toThrow();
    expect(() =>
      assertRequestSecurity(
        new Request("https://ois.test/api/companies/x/drivers", {
          method: "PATCH",
          headers: { origin: "https://attacker.test", "content-type": "application/json" },
          body: "{}",
        }),
      ),
    ).toThrow();
  });

  it("returns a stable safe error envelope and rejects invalid JSON before service invocation", async () => {
    const id = "safe-request-id";
    expect(
      (await errorResponse(new TenantRecordNotFoundError("Vehicle"), id).json()).error,
    ).toEqual({
      code: "TENANT_RECORD_NOT_FOUND",
      message: "Vehicle not found",
      requestId: id,
    });
    expect(errorResponse(new ConflictError("DUPLICATE_REGISTRATION", "safe"), id).status).toBe(409);
    expect(errorResponse(new ValidationError("INVALID_PATH", "safe"), id).status).toBe(400);
    await expect(
      readJson(new Request("https://ois.test", { method: "POST", body: "{" })),
    ).rejects.toThrow(ValidationError);
  });

  it("sanitizes unexpected errors without exposing internal failure details", async () => {
    const response = errorResponse(
      new Error("database password must not escape"),
      "safe-request-id",
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        requestId: "safe-request-id",
      },
    });
  });

  it("serializes only a safe licence summary", () => {
    const dto = licenceDto({
      id: "licence-id",
      driverId: "driver-id",
      licenceType: "DRIVER_LICENCE",
      issuingJurisdiction: null,
      licenceNumberLast4: "1234",
      issuedOn: null,
      expiresOn: new Date("2030-01-01T00:00:00.000Z"),
    });
    expect(dto).toEqual({
      id: "licence-id",
      driverId: "driver-id",
      licenceType: "DRIVER_LICENCE",
      issuingJurisdiction: null,
      licenceNumberLast4: "1234",
      issuedOn: null,
      expiresOn: "2030-01-01T00:00:00.000Z",
    });
    expect(JSON.stringify(dto)).not.toContain("ciphertext");
    expect(JSON.stringify(dto)).not.toContain("lookupHash");
  });
});
