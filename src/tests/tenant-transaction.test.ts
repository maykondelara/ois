/* eslint-disable no-unused-vars */
import { describe, expect, it } from "vitest";
import { withAuthenticatedUserTransaction, withTenantTransaction } from "@/db/tenant-transaction";
import type { TenantContext } from "@/modules/identity/tenant-context";

function fakeClient() {
  const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
  const transaction = {
    $executeRaw: async (strings: TemplateStringsArray, ...values: readonly unknown[]) => {
      calls.push({ sql: strings.join("?"), values });
      return 1;
    },
  };
  return {
    calls,
    client: {
      $transaction: async <T>(operation: (tx: typeof transaction) => Promise<T>) =>
        operation(transaction),
    },
  };
}

describe("transaction-local database contexts", () => {
  it("sets only current_user_id during membership bootstrap", async () => {
    const fake = fakeClient();
    await withAuthenticatedUserTransaction(
      fake.client as never,
      { userId: "user-a" },
      async () => undefined,
    );
    expect(fake.calls).toEqual([
      { sql: "SELECT set_config('app.current_user_id', ?, true)", values: ["user-a"] },
    ]);
  });

  it("sets both context values only inside the tenant transaction", async () => {
    const fake = fakeClient();
    const context: TenantContext = {
      actorUserId: "user-a",
      companyId: "company-a",
      membershipId: "membership-a",
      role: "OWNER",
      permissions: new Set(["company.read"]),
    };
    await withTenantTransaction(fake.client as never, context, async () => undefined);
    expect(fake.calls).toEqual([
      { sql: "SELECT set_config('app.current_user_id', ?, true)", values: ["user-a"] },
      { sql: "SELECT set_config('app.current_company_id', ?, true)", values: ["company-a"] },
    ]);
  });
});
