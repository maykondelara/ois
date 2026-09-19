import { PrismaClient } from "@prisma/client";

import { hashPassword } from "@/modules/identity/password.service";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

async function main() {
  const companyName = requireEnv("OIS_BOOTSTRAP_COMPANY_NAME");
  const companySlug = requireEnv("OIS_BOOTSTRAP_COMPANY_SLUG").toLowerCase();
  const ownerEmail = requireEnv("OIS_BOOTSTRAP_OWNER_EMAIL").toLowerCase();
  const ownerPassword = requireEnv("OIS_BOOTSTRAP_OWNER_PASSWORD");
  const databaseUrl = requireEnv("DATABASE_URL");

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });

  try {
    const ownerRole = await prisma.role.findUniqueOrThrow({
      where: { code: "OWNER" },
    });

    const existingCompany = await prisma.company.findUnique({
      where: { slug: companySlug },
      select: { id: true },
    });

    if (existingCompany) {
      throw new Error("A company with the bootstrap slug already exists");
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: ownerEmail },
      select: { id: true },
    });

    if (existingUser) {
      throw new Error("A user with the bootstrap owner email already exists");
    }

    const passwordHash = await hashPassword(ownerPassword);

    await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: companyName,
          slug: companySlug,
        },
      });

      const owner = await tx.user.create({
        data: {
          email: ownerEmail,
          accountStatus: "ACTIVE",
          passwordHash,
        },
      });

      await tx.companyMembership.create({
        data: {
          companyId: company.id,
          userId: owner.id,
          roleId: ownerRole.id,
          status: "ACTIVE",
        },
      });

      await tx.companyOperationalSettings.create({
        data: {
          companyId: company.id,
        },
      });
    });

    console.log("Pilot company and OWNER bootstrap completed successfully");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Pilot bootstrap failed");
  process.exitCode = 1;
});
