/* eslint-disable no-unused-vars */
import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/modules/identity/tenant-context";
import {
  linkDriverToUser,
  replaceDriverRegularAvailability,
} from "@/modules/drivers/driver.service";

const context: TenantContext = {
  actorUserId: "admin-a",
  companyId: "company-a",
  membershipId: "membership-a",
  role: "ADMIN",
  permissions: new Set(["drivers.manage", "drivers.read"]),
};

function fakeClient(activeMembership: boolean) {
  const availability: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const transaction = {
    $executeRaw: async (_strings: TemplateStringsArray, ..._values: unknown[]) => 1,
    driver: {
      findUnique: async () => ({
        id: "driver-a",
        companyId: "company-a",
        userId: null,
        operationalStatus: "ACTIVE",
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => ({ id: "driver-a", ...data }),
      findMany: async () => [],
      create: async () => ({ id: "driver-a" }),
    },
    companyMembership: {
      findFirst: async () => (activeMembership ? { id: "membership-target" } : null),
    },
    driverRegularAvailability: {
      upsert: async ({ create }: { create: Record<string, unknown> }) => (
        availability.push(create),
        create
      ),
    },
    vehicleCategory: { findFirst: async () => null },
    driverVehicleCapability: {
      upsert: async () => ({ id: "capability-a" }),
      updateMany: async () => ({ count: 1 }),
    },
    activity: {
      create: async ({ data }: { data: Record<string, unknown> }) => (audits.push(data), data),
    },
  };
  return {
    availability,
    audits,
    client: {
      $transaction: async <T>(operation: (tx: typeof transaction) => Promise<T>) =>
        operation(transaction),
    },
  };
}

describe("driver application service", () => {
  it("requires an active membership before linking a driver to an application user", async () => {
    const inactive = fakeClient(false);
    await expect(
      linkDriverToUser(inactive.client as never, context, "driver-a", {
        userId: "d66c1f1a-d477-4cc4-8f7b-6a2e5f760000",
      }),
    ).rejects.toMatchObject({ code: "INVALID_DRIVER_USER_LINK" });
    const active = fakeClient(true);
    await expect(
      linkDriverToUser(active.client as never, context, "driver-a", {
        userId: "d66c1f1a-d477-4cc4-8f7b-6a2e5f760000",
      }),
    ).resolves.toMatchObject({ id: "driver-a" });
  });

  it("upserts all seven weekday availability entries atomically", async () => {
    const fake = fakeClient(true);
    const entries = Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      isAvailable: dayOfWeek < 5,
    }));
    await replaceDriverRegularAvailability(fake.client as never, context, "driver-a", entries);
    expect(fake.availability).toHaveLength(7);
    expect(fake.audits[0]).toMatchObject({ action: "driver.availability_updated" });
  });
});
