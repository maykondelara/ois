import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { seedFoundation } from "@/modules/identity/seed.service";

describe("seed security", () => {
  it("does not create a demo company or user without a runtime password", async () => {
    let companyWrites = 0;
    let userWrites = 0;
    const client = {
      permission: { upsert: async () => undefined, findMany: async () => [] },
      role: {
        upsert: async ({ where }: { where: { code: string } }) => ({ id: where.code }),
        findUniqueOrThrow: async () => ({ id: "OWNER" }),
      },
      rolePermission: { upsert: async () => undefined },
      company: {
        upsert: async () => {
          companyWrites += 1;
          return { id: "company" };
        },
      },
      user: {
        upsert: async () => {
          userWrites += 1;
          return { id: "user" };
        },
      },
      companyMembership: { upsert: async () => undefined },
    };
    await seedFoundation(client as never);
    await seedFoundation(client as never);
    expect(companyWrites).toBe(0);
    expect(userWrites).toBe(0);
  });

  it("requires an environment-supplied development password and commits no assigned value", async () => {
    const source = await readFile("prisma/seed.ts", "utf8");
    expect(source).toContain("process.env.OIS_DEVELOPMENT_SEED_PASSWORD");
    expect(source).not.toMatch(/OIS_DEVELOPMENT_SEED_PASSWORD\s*=\s*["']/);
  });
});
