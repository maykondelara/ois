import { describe, expect, it } from "vitest";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import type { TenantContext } from "@/modules/identity/tenant-context";

describe("tenant audit activity", () => {
  it("records the actor and company from TenantContext, not caller input", async () => {
    let captured: unknown;
    const transaction = {
      activity: {
        create: async (input: unknown) => {
          captured = input;
          return input;
        },
      },
    };
    const context: TenantContext = {
      actorUserId: "user-a",
      companyId: "company-a",
      membershipId: "membership-a",
      role: "ADMIN",
      permissions: new Set(["company.manage"]),
    };
    await recordTenantActivity(transaction as never, context, {
      action: "company.updated",
      entityType: "company",
      entityId: "company-a",
    });
    expect(captured).toMatchObject({
      data: { companyId: "company-a", actorUserId: "user-a", action: "company.updated" },
    });
  });
});
