/* eslint-disable no-unused-vars */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AuthenticatedUserContext, TenantContext } from "@/modules/identity/tenant-context";

export type TenantTransaction = Prisma.TransactionClient;
type TransactionalClient = Pick<PrismaClient, "$transaction">;

async function setAuthenticatedUserContext(transaction: TenantTransaction, userId: string) {
  await transaction.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
}

async function setTenantContext(transaction: TenantTransaction, context: TenantContext) {
  await setAuthenticatedUserContext(transaction, context.actorUserId);
  await transaction.$executeRaw`SELECT set_config('app.current_company_id', ${context.companyId}, true)`;
}

/** Stage 1: current_user_id only. Membership RLS is the authorization bootstrap. */
export async function withAuthenticatedUserTransaction<T>(
  client: TransactionalClient,
  actor: AuthenticatedUserContext,
  operation: (transaction: TenantTransaction) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await setAuthenticatedUserContext(transaction, actor.userId);
    return operation(transaction);
  });
}

/** Stage 2: a validated membership grants both transaction-local settings. */
export async function withTenantTransaction<T>(
  client: TransactionalClient,
  context: TenantContext,
  operation: (transaction: TenantTransaction) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
    await setTenantContext(transaction, context);
    return operation(transaction);
  });
}
