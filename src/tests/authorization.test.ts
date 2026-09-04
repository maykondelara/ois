import { describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/errors";
import { requirePermission, requireRecordScope } from "@/modules/identity/authorization";
import { rolePermissionMatrix } from "@/modules/identity/permissions";
import { tenantContextFromMembership } from "@/modules/identity/tenant-context";

const actor = { userId: "user-a" };
const activeMembership = {
  id: "membership-a",
  companyId: "company-a",
  userId: "user-a",
  status: "ACTIVE",
  role: "DRIVER",
  permissions: rolePermissionMatrix.DRIVER,
};

describe("TenantContext and RBAC", () => {
  it("does not authorize a requested company without an active matching membership", () => {
    expect(tenantContextFromMembership(actor, "company-b", activeMembership)).toBeNull();
    expect(
      tenantContextFromMembership(actor, "company-a", { ...activeMembership, status: "SUSPENDED" }),
    ).toBeNull();
  });

  it("enforces capabilities on the server-side context", () => {
    const context = tenantContextFromMembership(actor, "company-a", activeMembership);
    expect(context).not.toBeNull();
    expect(() => requirePermission(context!, "inspections.submit")).not.toThrow();
    expect(() => requirePermission(context!, "company.manage")).toThrow(AuthorizationError);
  });

  it("enforces company and driver record scope", () => {
    const context = tenantContextFromMembership(actor, "company-a", activeMembership)!;
    expect(() =>
      requireRecordScope(context, { companyId: "company-b", driverUserId: "user-a" }),
    ).toThrow(AuthorizationError);
    expect(() =>
      requireRecordScope(context, { companyId: "company-a", driverUserId: "user-b" }),
    ).toThrow(AuthorizationError);
    expect(() =>
      requireRecordScope(context, { companyId: "company-a", driverUserId: "user-a" }),
    ).not.toThrow();
  });
});
