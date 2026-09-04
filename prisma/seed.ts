import { PrismaClient } from "@prisma/client";
import { seedFoundation } from "../src/modules/identity/seed.service";

// Seeding is a controlled deployment operation, never an application request.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

async function main() {
  await seedFoundation(prisma, process.env.OIS_DEVELOPMENT_SEED_PASSWORD);
}

main().finally(async () => prisma.$disconnect());
