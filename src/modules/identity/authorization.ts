import { AuthorizationError } from "@/lib/errors";
import type { PermissionCode } from "@/modules/identity/permissions";
import type { TenantContext } from "@/modules/identity/tenant-context";

export function requirePermission(
  context: TenantContext,
  permission: PermissionCode,
): TenantContext {
  if (!context.permissions.has(permission))
    throw new AuthorizationError(`Missing permission: ${permission}`);
  return context;
}

/** Record scope supplements permissions; it never substitutes for tenant isolation. */
export function requireRecordScope(
  context: TenantContext,
  record: { companyId: string; driverUserId?: string | null },
): TenantContext {
  if (record.companyId !== context.companyId)
    throw new AuthorizationError("Record belongs to another company");
  if (context.role === "DRIVER" && record.driverUserId !== context.actorUserId) {
    throw new AuthorizationError("Driver record scope denied");
  }
  return context;
}
