import { describe, expect, it } from "vitest";
import { authenticateCredentials } from "@/auth/authenticate-credentials";
import { hashPassword } from "@/modules/identity/password.service";

describe("credentials authentication", () => {
  it("accepts only an active user with a valid Argon2id password", async () => {
    const passwordHash = await hashPassword("correct-password");
    const client = {
      user: {
        findUnique: async () => ({
          id: "user-a",
          email: "a@example.test",
          name: "A",
          passwordHash,
          accountStatus: "ACTIVE",
        }),
      },
    };
    await expect(
      authenticateCredentials(client as never, {
        email: "A@EXAMPLE.TEST",
        password: "correct-password",
      }),
    ).resolves.toMatchObject({ id: "user-a" });
    await expect(
      authenticateCredentials(client as never, { email: "a@example.test", password: "wrong" }),
    ).resolves.toBeNull();
  });

  it("denies disabled accounts even with a valid password", async () => {
    const passwordHash = await hashPassword("correct-password");
    const client = {
      user: {
        findUnique: async () => ({
          id: "user-a",
          email: "a@example.test",
          name: "A",
          passwordHash,
          accountStatus: "SUSPENDED",
        }),
      },
    };
    await expect(
      authenticateCredentials(client as never, {
        email: "a@example.test",
        password: "correct-password",
      }),
    ).resolves.toBeNull();
  });
});
