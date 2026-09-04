import type { PrismaClient } from "@prisma/client";
import { AuthorizationError } from "@/lib/errors";
import { withAuthenticatedUserTransaction, withTenantTransaction } from "@/db/tenant-transaction";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import { isPermissionCode } from "@/modules/identity/permissions";
import {
  tenantContextFromMembership,
  type AuthenticatedUserContext,
  type TenantContext,
} from "@/modules/identity/tenant-context";

type TenantBootstrapClient = Pick<PrismaClient, "$transaction">;

/** Client company selection is validated under Stage 1 RLS; it is never authorization by itself. */
export async function resolveTenantContext(
  client: TenantBootstrapClient,
  actor: AuthenticatedUserContext,
  requestedCompanyId: string,
): Promise<TenantContext> {
  const membership = await withAuthenticatedUserTransaction(client, actor, async (transaction) => {
    const candidate = await transaction.companyMembership.findFirst({
      where: { companyId: requestedCompanyId, userId: actor.userId, status: "ACTIVE" },
      select: { id: true, companyId: true, userId: true, status: true, roleId: true },
    });
    if (!candidate) return null;

    const role = await transaction.role.findUnique({
      where: { id: candidate.roleId },
      select: { code: true },
    });
    if (!role) return null;
    const mappings = await transaction.rolePermission.findMany({
      where: { roleId: candidate.roleId },
      select: { permissionId: true },
    });
    const permissionIds = mappings.map((mapping) => mapping.permissionId);
    const permissions =
      permissionIds.length === 0
        ? []
        : await transaction.permission.findMany({
            where: { id: { in: permissionIds } },
            select: { code: true },
          });
    return {
      ...candidate,
      role: role.code,
      permissions: permissions.map((permission) => permission.code).filter(isPermissionCode),
    };
  });

  const context = tenantContextFromMembership(actor, requestedCompanyId, membership);
  if (!context) throw new AuthorizationError("No active membership for the requested company");
  await withTenantTransaction(client, context, async (transaction) => {
    await recordTenantActivity(transaction, context, {
      action: "tenant_context.established",
      entityType: "company_membership",
      entityId: context.membershipId,
    });
  });
  return context;
}
