import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { prisma } from "@/db/prisma";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";
import {
  requirePermission as requireCapability,
  requireRecordScope as checkScope,
} from "@/modules/identity/authorization";
import { resolveTenantContext } from "@/modules/identity/tenant-context.service";
import type { AuthenticatedUserContext, TenantContext } from "@/modules/identity/tenant-context";
import type { PermissionCode } from "@/modules/identity/permissions";

export async function requireAuthentication(): Promise<AuthenticatedUserContext> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) throw new AuthenticationError();
  return { userId };
}

export async function requireTenantContext(requestedCompanyId: string): Promise<TenantContext> {
  const actor = await requireAuthentication();
  return resolveTenantContext(prisma, actor, requestedCompanyId);
}

export function requirePermission(
  context: TenantContext,
  permission: PermissionCode,
): TenantContext {
  return requireCapability(context, permission);
}

export function requireRecordScope(
  context: TenantContext,
  record: { companyId: string; driverUserId?: string | null },
): TenantContext {
  if (!record.companyId) throw new AuthorizationError("Record scope is invalid");
  return checkScope(context, record);
}
