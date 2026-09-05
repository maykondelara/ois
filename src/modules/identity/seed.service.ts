import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/modules/identity/password.service";
import { permissionCodes, roleCodes, rolePermissionMatrix } from "@/modules/identity/permissions";
import { defaultVehicleCategories } from "@/modules/vehicles/registration";

type SeedClient = Pick<
  PrismaClient,
  | "permission"
  | "role"
  | "rolePermission"
  | "company"
  | "user"
  | "companyMembership"
  | "companyOperationalSettings"
  | "vehicleCategory"
>;

type SeedOptions = Readonly<{ includePhase3A?: boolean }>;

/** Controlled deployment seed; a demo user is impossible unless its password is supplied at runtime. */
export async function seedFoundation(
  client: SeedClient,
  developmentPassword?: string,
  options: SeedOptions = {},
) {
  for (const code of permissionCodes) {
    await client.permission.upsert({
      where: { code },
      update: {},
      create: { code, description: `OIS capability: ${code}` },
    });
  }
  for (const code of roleCodes) {
    const role = await client.role.upsert({
      where: { code },
      update: { name: code },
      create: { code, name: code },
    });
    const permissions = await client.permission.findMany({
      where: { code: { in: [...rolePermissionMatrix[code]] } },
      select: { id: true },
    });
    for (const permission of permissions) {
      await client.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }
  if (!developmentPassword) return;
  const passwordHash = await hashPassword(developmentPassword);
  const company = await client.company.upsert({
    where: { slug: "ois-demo" },
    update: { name: "OIS Demo Transport" },
    create: { name: "OIS Demo Transport", slug: "ois-demo" },
  });
  const owner = await client.user.upsert({
    where: { email: "owner@ois-demo.test" },
    update: { accountStatus: "ACTIVE", passwordHash },
    create: { email: "owner@ois-demo.test", accountStatus: "ACTIVE", passwordHash },
  });
  const ownerRole = await client.role.findUniqueOrThrow({ where: { code: "OWNER" } });
  await client.companyMembership.upsert({
    where: { companyId_userId: { companyId: company.id, userId: owner.id } },
    update: { roleId: ownerRole.id, status: "ACTIVE" },
    create: { companyId: company.id, userId: owner.id, roleId: ownerRole.id, status: "ACTIVE" },
  });
  if (options.includePhase3A === false) return;
  await client.companyOperationalSettings.upsert({
    where: { companyId: company.id },
    update: {},
    create: { companyId: company.id },
  });
  for (const code of defaultVehicleCategories) {
    await client.vehicleCategory.upsert({
      where: { companyId_code: { companyId: company.id, code } },
      update: { name: code, isActive: true },
      create: { companyId: company.id, code, name: code },
    });
  }
}
