/* eslint-disable no-unused-vars */
import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/modules/identity/tenant-context";
import {
  initializeOperationalDefaults,
  updateOperationalSettings,
} from "@/modules/companies/operational-settings.service";
import {
  createVehicleCategory,
  updateVehicleCategory,
} from "@/modules/vehicles/vehicle-category.service";

const context: TenantContext = {
  actorUserId: "user-a",
  companyId: "company-a",
  membershipId: "membership-a",
  role: "ADMIN",
  permissions: new Set(["company.manage", "company.read", "vehicles.manage", "vehicles.read"]),
};

function fakeClient() {
  const categories: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const transaction = {
    $executeRaw: async (_strings: TemplateStringsArray, ..._values: unknown[]) => 1,
    companyOperationalSettings: {
      findUnique: async () => null,
      upsert: async ({
        create,
        update,
      }: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => ({
        ...create,
        ...update,
      }),
    },
    vehicleCategory: {
      upsert: async ({ create }: { create: Record<string, unknown> }) => (
        categories.push(create),
        create
      ),
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: "category-a",
        ...data,
        isActive: true,
      }),
      findUnique: async () => ({
        id: "category-a",
        companyId: "company-a",
        code: "VAN",
        name: "Van",
        isActive: true,
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => ({
        id: "category-a",
        code: "VAN",
        ...data,
      }),
      findMany: async () => [],
    },
    activity: {
      create: async ({ data }: { data: Record<string, unknown> }) => (audits.push(data), data),
    },
  };
  return {
    categories,
    audits,
    client: {
      $transaction: async <T>(operation: (tx: typeof transaction) => Promise<T>) =>
        operation(transaction),
    },
  };
}

describe("operational configuration services", () => {
  it("initializes only the missing approved defaults and does not reactivate categories", async () => {
    const fake = fakeClient();
    await initializeOperationalDefaults(fake.client as never, context);
    expect(fake.categories.map((category) => category.code)).toEqual([
      "VAN",
      "LR",
      "MR",
      "HR",
      "HC",
      "MC",
    ]);
    expect(
      fake.categories.every((category) => Object.keys(category).every((key) => key !== "isActive")),
    ).toBe(true);
  });

  it("updates settings and records safe company audit metadata", async () => {
    const fake = fakeClient();
    const settings = await updateOperationalSettings(fake.client as never, context, {
      odometerExpectedIncreaseThresholdKm: 2000,
      inspectionVehicleSelectionStrategy: "MANUAL_REGO",
    });
    expect(settings).toMatchObject({
      odometerExpectedIncreaseThresholdKm: 2000,
      inspectionVehicleSelectionStrategy: "MANUAL_REGO",
    });
    expect(fake.audits[0]).toMatchObject({ action: "company.operational_settings_updated" });
  });

  it("creates, deactivates, and records category lifecycle events", async () => {
    const fake = fakeClient();
    await createVehicleCategory(fake.client as never, context, {
      code: "FORKLIFT",
      name: "Forklift",
    });
    await updateVehicleCategory(fake.client as never, context, "category-a", { isActive: false });
    expect(fake.audits.map((audit) => audit.action)).toEqual([
      "vehicle_category.created",
      "vehicle_category.deactivated",
    ]);
  });
});
