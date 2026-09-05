/* eslint-disable no-unused-vars */
import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/modules/identity/tenant-context";
import { changeManualVehicleStatus, createVehicle } from "@/modules/vehicles/vehicle.service";

const context: TenantContext = {
  actorUserId: "admin-a",
  companyId: "company-a",
  membershipId: "membership-a",
  role: "ADMIN",
  permissions: new Set(["vehicles.manage", "vehicles.read"]),
};

function fakeClient(currentStatus = "ACTIVE") {
  const histories: Array<Record<string, unknown>> = [];
  const readings: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const transaction = {
    $executeRaw: async (_strings: TemplateStringsArray, ..._values: unknown[]) => 1,
    vehicleCategory: { findFirst: async () => ({ id: "category-a" }) },
    vehicle: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "vehicle-a", ...data }),
      findUnique: async () => ({
        id: "vehicle-a",
        companyId: "company-a",
        operationalStatus: currentStatus,
        nextServiceOdometerKm: null,
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => ({ id: "vehicle-a", ...data }),
      findMany: async () => [],
    },
    vehicleStatusHistory: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: `history-${histories.push(data)}`,
        ...data,
      }),
    },
    vehicleOdometerReading: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: `reading-${readings.push(data)}`,
        ...data,
      }),
    },
    activity: {
      create: async ({ data }: { data: Record<string, unknown> }) => (audits.push(data), data),
    },
  };
  return {
    histories,
    readings,
    audits,
    client: {
      $transaction: async <T>(operation: (tx: typeof transaction) => Promise<T>) =>
        operation(transaction),
    },
  };
}

describe("vehicle application service", () => {
  it("creates an initial odometer baseline and status history in the same tenant transaction", async () => {
    const fake = fakeClient();
    await createVehicle(fake.client as never, context, {
      registration: "ab-123",
      vehicleCategoryId: "2b9715d8-c6e9-411d-9b96-15fba2f2b1c5",
      initialOdometerKm: 100_000,
    });
    expect(fake.histories[0]).toMatchObject({ fromStatus: null, toStatus: "ACTIVE" });
    expect(fake.readings[0]).toMatchObject({
      source: "INITIAL_ENTRY",
      status: "ACCEPTED",
      readingKm: 100_000,
    });
    expect(fake.audits.map((audit) => audit.action)).toContain("vehicle.created");
  });

  it("requires a reason for administrative out-of-service entry and restoration", async () => {
    const active = fakeClient("ACTIVE");
    await expect(
      changeManualVehicleStatus(active.client as never, context, "vehicle-a", {
        status: "OUT_OF_SERVICE",
      }),
    ).rejects.toMatchObject({ code: "MISSING_OUT_OF_SERVICE_REASON" });
    await expect(
      changeManualVehicleStatus(active.client as never, context, "vehicle-a", {
        status: "OUT_OF_SERVICE",
        reason: "Safety hold",
      }),
    ).resolves.toMatchObject({ operationalStatus: "OUT_OF_SERVICE" });
    const outOfService = fakeClient("OUT_OF_SERVICE");
    await expect(
      changeManualVehicleStatus(outOfService.client as never, context, "vehicle-a", {
        status: "ACTIVE",
        reason: "Administrative clearance",
      }),
    ).resolves.toMatchObject({ operationalStatus: "ACTIVE" });
  });
});
