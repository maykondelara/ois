export const permissionCodes = [
  "company.read",
  "company.manage",
  "drivers.read",
  "drivers.manage",
  "vehicles.read",
  "vehicles.manage",
  "inspections.submit",
  "inspections.read",
  "inspections.review",
  "defects.read",
  "defects.manage",
  "tasks.read",
  "tasks.manage",
  "maintenance.read",
  "maintenance.manage",
  "documents.read",
  "documents.manage",
  "reports.read",
  "integrations.read",
  "integrations.manage",
] as const;

export type PermissionCode = (typeof permissionCodes)[number];

export const roleCodes = ["OWNER", "ADMIN", "MANAGER", "SUPERVISOR", "DRIVER"] as const;
export type RoleCode = (typeof roleCodes)[number];

const allPermissions = [...permissionCodes];

export const rolePermissionMatrix: Record<RoleCode, readonly PermissionCode[]> = {
  OWNER: allPermissions,
  ADMIN: allPermissions,
  MANAGER: [
    "company.read",
    "drivers.read",
    "drivers.manage",
    "vehicles.read",
    "vehicles.manage",
    "inspections.read",
    "inspections.review",
    "defects.read",
    "defects.manage",
    "tasks.read",
    "tasks.manage",
    "maintenance.read",
    "maintenance.manage",
    "documents.read",
    "documents.manage",
    "reports.read",
  ],
  SUPERVISOR: [
    "company.read",
    "drivers.read",
    "vehicles.read",
    "inspections.submit",
    "inspections.read",
    "inspections.review",
    "defects.read",
    "defects.manage",
    "tasks.read",
    "tasks.manage",
    "maintenance.read",
    "documents.read",
  ],
  DRIVER: ["drivers.read", "vehicles.read", "inspections.submit", "documents.read"],
};

export function isPermissionCode(value: string): value is PermissionCode {
  return (permissionCodes as readonly string[]).includes(value);
}
