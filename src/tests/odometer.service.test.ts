/* eslint-disable no-unused-vars */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConflictError } from "@/lib/errors";
import type { TenantContext } from "@/modules/identity/tenant-context";
import { OdometerConfirmationTokenService } from "@/modules/vehicles/odometer-confirmation";
import {
  reviewOdometerReading,
  submitManualOdometerReading,
} from "@/modules/vehicles/odometer.service";

const context: TenantContext = {
  actorUserId: "user-a",
  companyId: "company-a",
  membershipId: "membership-a",
  role: "MANAGER",
  permissions: new Set(["vehicles.odometer.submit", "vehicles.odometer.review"]),
};

function fakeClient(input: {
  latest?: number;
  pending?: boolean;
  target?: { readingKm: number; status: string };
}) {
  const created: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const latest =
    input.latest === undefined
      ? null
      : {
          id: "accepted-a",
          readingKm: input.latest,
          status: "ACCEPTED",
          acceptedAt: new Date(),
          source: "INITIAL_ENTRY",
          actorUserId: "user-a",
        };
  const target = input.target
    ? {
        id: "pending-a",
        vehicleId: "vehicle-a",
        ...input.target,
        acceptedAt: null,
        source: "MANUAL_ENTRY",
        actorUserId: "user-a",
      }
    : null;
  const transaction = {
    $executeRaw: async (_strings: TemplateStringsArray, ..._values: unknown[]) => 1,
    $queryRaw: async () => [{ id: "vehicle-a" }],
    vehicleOdometerReading: {
      findFirst: async (query: { where: { status: string } }) => {
        if (query.where.status === "REVIEW_REQUIRED")
          return input.pending ? { id: "pending-a" } : null;
        return latest;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `reading-${created.length}`, ...data };
      },
      findUnique: async () => target,
      update: async ({ data }: { data: Record<string, unknown> }) => ({
        id: "pending-a",
        ...target,
        ...data,
      }),
    },
    companyOperationalSettings: {
      findUnique: async () => ({ odometerExpectedIncreaseThresholdKm: 1000 }),
    },
    vehicle: { findUnique: async () => ({ id: "vehicle-a", nextServiceOdometerKm: null }) },
    activity: {
      create: async ({ data }: { data: Record<string, unknown> }) => (audits.push(data), data),
    },
  };
  return {
    created,
    audits,
    client: {
      $transaction: async <T>(operation: (tx: typeof transaction) => Promise<T>) =>
        operation(transaction),
    },
  };
}

describe("odometer application service", () => {
  it("accepts a normal reading and audits immutable reading provenance", async () => {
    const fake = fakeClient({ latest: 100_000 });
    const result = await submitManualOdometerReading(
      fake.client as never,
      context,
      new OdometerConfirmationTokenService(randomBytes(32)),
      "vehicle-a",
      { readingKm: 100_500 },
    );
    expect(result).toMatchObject({ kind: "ACCEPTED", readingKm: 100_500 });
    expect(fake.created[0]).toMatchObject({
      status: "ACCEPTED",
      previousAcceptedOdometerKm: 100_000,
      differenceKm: 500,
    });
    expect(fake.audits.map((audit) => audit.action)).toEqual([
      "vehicle.odometer_submitted",
      "vehicle.odometer_accepted",
    ]);
  });

  it("does not persist an anomalous preview, then persists review-required only after confirmation", async () => {
    const fake = fakeClient({ latest: 100_000 });
    const confirmations = new OdometerConfirmationTokenService(randomBytes(32));
    const preview = await submitManualOdometerReading(
      fake.client as never,
      context,
      confirmations,
      "vehicle-a",
      { readingKm: 102_000 },
    );
    expect(preview.kind).toBe("ANOMALY_CONFIRMATION_REQUIRED");
    expect(fake.created).toHaveLength(0);
    if (preview.kind !== "ANOMALY_CONFIRMATION_REQUIRED") throw new Error("expected preview");
    const confirmed = await submitManualOdometerReading(
      fake.client as never,
      context,
      confirmations,
      "vehicle-a",
      { readingKm: 102_000, confirmationToken: preview.confirmationToken },
    );
    expect(confirmed).toMatchObject({ kind: "REVIEW_REQUIRED" });
    expect(fake.created[0]).toMatchObject({ status: "REVIEW_REQUIRED", differenceKm: 2000 });
  });

  it("rejects submissions when a review is pending", async () => {
    const fake = fakeClient({ latest: 100_000, pending: true });
    await expect(
      submitManualOdometerReading(
        fake.client as never,
        context,
        OdometerConfirmationTokenService.forTests(),
        "vehicle-a",
        { readingKm: 100_100 },
      ),
    ).rejects.toMatchObject({
      code: "UNRESOLVED_ODOMETER_REVIEW",
    } satisfies Partial<ConflictError>);
  });

  it("allows stale review rejection while blocking stale acceptance", async () => {
    const fake = fakeClient({
      latest: 100_000,
      target: { readingKm: 99_000, status: "REVIEW_REQUIRED" },
    });
    await expect(
      reviewOdometerReading(fake.client as never, context, "vehicle-a", "pending-a", {
        decision: "ACCEPT",
        reviewNote: "reviewed",
      }),
    ).rejects.toMatchObject({ code: "STALE_ODOMETER_REVIEW" });
    await expect(
      reviewOdometerReading(fake.client as never, context, "vehicle-a", "pending-a", {
        decision: "REJECT",
        reviewNote: "below baseline",
      }),
    ).resolves.toMatchObject({ status: "REJECTED" });
  });
});
