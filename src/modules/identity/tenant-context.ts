import {
  isPermissionCode,
  type PermissionCode,
  type RoleCode,
} from "@/modules/identity/permissions";

export type AuthenticatedUserContext = Readonly<{ userId: string }>;

export type TenantContext = Readonly<{
  actorUserId: string;
  companyId: string;
  membershipId: string;
  role: RoleCode;
  permissions: ReadonlySet<PermissionCode>;
}>;

export type ActiveMembership = Readonly<{
  id: string;
  companyId: string;
  userId: string;
  status: string;
  role: string;
  permissions: readonly string[];
}>;

export function tenantContextFromMembership(
  actor: AuthenticatedUserContext,
  requestedCompanyId: string,
  membership: ActiveMembership | null,
): TenantContext | null {
  if (
    !membership ||
    membership.userId !== actor.userId ||
    membership.companyId !== requestedCompanyId ||
    membership.status !== "ACTIVE"
  ) {
    return null;
  }

  return {
    actorUserId: actor.userId,
    companyId: membership.companyId,
    membershipId: membership.id,
    role: membership.role as RoleCode,
    permissions: new Set(membership.permissions.filter(isPermissionCode)),
  };
}
