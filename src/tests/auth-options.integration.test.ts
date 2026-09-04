/* eslint-disable no-unused-vars */
import { vi } from "vitest";

vi.hoisted(() => {
  process.env.AUTH_SECRET = "test-only-auth-secret-with-sufficient-length";
});

import { describe, expect, it } from "vitest";
import { createAuthOptions } from "@/auth";
import { hashPassword } from "@/modules/identity/password.service";

type CallbackOptions = ReturnType<typeof createAuthOptions>;

function fakeClient(status = "ACTIVE") {
  const sessions: Array<{ sessionToken: string; userId: string; expires: Date }> = [];
  const user = {
    id: "user-a",
    email: "a@example.test",
    name: "A",
    passwordHash: "",
    accountStatus: status,
  };
  return {
    sessions,
    client: {
      user: {
        findUnique: async ({ where }: { where: { email?: string; id?: string } }) => {
          if (where.email) return where.email === user.email ? user : null;
          return where.id === user.id ? { accountStatus: user.accountStatus } : null;
        },
      },
      session: {
        create: async ({
          data,
        }: {
          data: { sessionToken: string; userId: string; expires: Date };
        }) => {
          sessions.push(data);
          return data;
        },
        findUnique: async ({ where }: { where: { sessionToken: string } }) =>
          sessions.find((session) => session.sessionToken === where.sessionToken) ?? null,
        deleteMany: async () => ({ count: 0 }),
      },
    },
    user,
  };
}

function callbacks(options: CallbackOptions) {
  return options.callbacks as NonNullable<CallbackOptions["callbacks"]>;
}

describe("Auth.js credentials/session boundary", () => {
  it("authenticates valid credentials and persists the resulting application user identity", async () => {
    const fake = fakeClient();
    fake.user.passwordHash = await hashPassword("test-password");
    const options = createAuthOptions(
      fake.client as never,
      "test-only-auth-secret-with-sufficient-length",
    );
    const provider = options.providers[0] as unknown as {
      options: { authorize: (input: unknown) => Promise<{ id: string } | null> };
    };
    await expect(
      Promise.resolve(
        provider.options.authorize({ email: "a@example.test", password: "test-password" }),
      ),
    ).resolves.toMatchObject({ id: "user-a" });

    const token = await callbacks(options).jwt!({ token: {}, user: { id: "user-a" } } as never);
    expect(token.userId).toBe("user-a");
    expect(fake.sessions).toHaveLength(1);
  });

  it("rejects invalid credentials and suspended users", async () => {
    const fake = fakeClient();
    fake.user.passwordHash = await hashPassword("test-password");
    const options = createAuthOptions(
      fake.client as never,
      "test-only-auth-secret-with-sufficient-length",
    );
    const provider = options.providers[0] as unknown as {
      options: { authorize: (input: unknown) => Promise<unknown> };
    };
    await expect(
      Promise.resolve(provider.options.authorize({ email: "a@example.test", password: "wrong" })),
    ).resolves.toBeNull();
    fake.user.accountStatus = "SUSPENDED";
    await expect(
      Promise.resolve(
        provider.options.authorize({ email: "a@example.test", password: "test-password" }),
      ),
    ).resolves.toBeNull();
  });

  it("rejects a session whose persisted identity differs or whose user becomes suspended", async () => {
    const fake = fakeClient();
    fake.user.passwordHash = await hashPassword("test-password");
    const options = createAuthOptions(
      fake.client as never,
      "test-only-auth-secret-with-sufficient-length",
    );
    fake.sessions.push({
      sessionToken: "token-a",
      userId: "user-b",
      expires: new Date(Date.now() + 60_000),
    });
    const spoofed = await callbacks(options).session!({
      session: { user: { id: "client-supplied" }, expires: new Date().toISOString() },
      token: { userId: "user-a", sessionToken: "token-a" },
    } as never);
    expect(spoofed.user.id).toBe("");

    fake.sessions[0] = {
      sessionToken: "token-a",
      userId: "user-a",
      expires: new Date(Date.now() + 60_000),
    };
    fake.user.accountStatus = "SUSPENDED";
    const suspended = await callbacks(options).session!({
      session: { user: { id: "client-supplied" }, expires: new Date().toISOString() },
      token: { userId: "user-a", sessionToken: "token-a" },
    } as never);
    expect(suspended.user.id).toBe("");
  });
});
