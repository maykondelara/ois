/* eslint-disable no-unused-vars */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/modules/identity/tenant-context";
import { updateCompanyProfile } from "@/modules/companies/company-profile.service";
import { getSetupReadiness } from "@/modules/companies/setup-readiness.service";

const owner: TenantContext = {
  actorUserId: "user-a",
  companyId: "company-a",
  membershipId: "membership-a",
  role: "OWNER",
  permissions: new Set(["company.read", "company.manage"]),
};

function readinessClient(counts: {
  category: number;
  driver: number;
  vehicle: number;
  requirement: number;
  template: number;
  settings: boolean;
}) {
  const whereCalls: unknown[] = [];
  const transaction = {
    $executeRaw: async () => 1,
    company: {
      findUnique: async () => ({
        id: "company-a",
        name: "Pilot Transport",
        timezone: "Australia/Perth",
      }),
    },
    companyOperationalSettings: {
      findUnique: async () => (counts.settings ? { companyId: "company-a" } : null),
    },
    vehicleCategory: {
      count: async ({ where }: { where: unknown }) => (whereCalls.push(where), counts.category),
    },
    driver: {
      count: async ({ where }: { where: unknown }) => (whereCalls.push(where), counts.driver),
    },
    vehicle: {
      count: async ({ where }: { where: unknown }) => (whereCalls.push(where), counts.vehicle),
    },
    complianceRequirement: {
      count: async ({ where }: { where: unknown }) => (whereCalls.push(where), counts.requirement),
    },
    inspectionTemplate: {
      count: async ({ where }: { where: unknown }) => (whereCalls.push(where), counts.template),
    },
  };
  return {
    whereCalls,
    client: {
      $transaction: async <T>(operation: (tx: typeof transaction) => Promise<T>) =>
        operation(transaction),
    },
  };
}

describe("Phase 4B.1 setup readiness", () => {
  it("derives NOT_STARTED, IN_PROGRESS and READY without persisted setup state", async () => {
    await expect(
      getSetupReadiness(
        readinessClient({
          category: 0,
          driver: 0,
          vehicle: 0,
          requirement: 0,
          template: 0,
          settings: false,
        }).client as never,
        owner,
      ),
    ).resolves.toMatchObject({ state: "NOT_STARTED" });
    await expect(
      getSetupReadiness(
        readinessClient({
          category: 1,
          driver: 0,
          vehicle: 0,
          requirement: 0,
          template: 0,
          settings: true,
        }).client as never,
        owner,
      ),
    ).resolves.toMatchObject({ state: "IN_PROGRESS" });
    const ready = readinessClient({
      category: 1,
      driver: 1,
      vehicle: 1,
      requirement: 1,
      template: 1,
      settings: true,
    });
    await expect(getSetupReadiness(ready.client as never, owner)).resolves.toMatchObject({
      state: "READY",
      checks: { publishedInspection: true },
    });
    expect(ready.whereCalls).toEqual(
      expect.arrayContaining([expect.objectContaining({ companyId: "company-a" })]),
    );
  });

  it("denies DRIVER setup access before opening a tenant transaction", async () => {
    const transaction = vi.fn();
    await expect(
      getSetupReadiness({ $transaction: transaction } as never, {
        ...owner,
        role: "DRIVER",
        permissions: new Set([]),
      }),
    ).rejects.toMatchObject({ name: "AuthorizationError" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("validates company timezone and records an audited profile update", async () => {
    const audits: unknown[] = [];
    const transaction = {
      $executeRaw: async () => 1,
      company: {
        findUnique: async () => ({ id: "company-a", name: "Old", timezone: "Australia/Perth" }),
        update: async ({ data }: { data: Record<string, unknown> }) => ({
          id: "company-a",
          slug: "pilot",
          status: "ACTIVE",
          ...data,
        }),
      },
      activity: { create: async ({ data }: { data: unknown }) => (audits.push(data), data) },
    };
    const client = {
      $transaction: async <T>(operation: (tx: typeof transaction) => Promise<T>) =>
        operation(transaction),
    };
    await expect(
      updateCompanyProfile(client as never, owner, { name: "Pilot", timezone: "Invalid/Timezone" }),
    ).rejects.toMatchObject({ code: "INVALID_COMPANY_TIMEZONE" });
    await expect(
      updateCompanyProfile(client as never, owner, { name: "Pilot", timezone: "Australia/Perth" }),
    ).resolves.toMatchObject({ name: "Pilot" });
    expect(audits[0]).toMatchObject({ action: "company.profile_updated" });
  });

  it("gates Setup navigation and exposes operational handoffs without internal model language", () => {
    const root = process.cwd();
    const navigation = fs.readFileSync(
      path.join(root, "src/app/companies/[companyId]/navigation.tsx"),
      "utf8",
    );
    const workspace = fs.readFileSync(
      path.join(root, "src/app/companies/[companyId]/setup/workspace.tsx"),
      "utf8",
    );
    expect(navigation).toContain('["Setup", "/setup"]');
    expect(navigation).toContain('label !== "Setup" || canAccessSetup');
    for (const target of ["/drivers", "/vehicles", "/compliance", "/inspections"])
      expect(workspace).toContain(target);
    expect(workspace).not.toMatch(/tenant rows|role_permission|RLS configuration/i);
  });
});
