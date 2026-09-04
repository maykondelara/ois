import type { Prisma } from "@prisma/client";
import type { TenantTransaction } from "@/db/tenant-transaction";
import type { TenantContext } from "@/modules/identity/tenant-context";

export type AuditInput = Readonly<{
  action: string;
  entityType: string;
  entityId?: string;
  requestId?: string;
  metadata?: Prisma.InputJsonValue;
}>;

/** Audit writes share the same tenant transaction as the protected mutation. */
export async function recordTenantActivity(
  transaction: TenantTransaction,
  context: TenantContext,
  input: AuditInput,
) {
  return transaction.activity.create({
    data: {
      companyId: context.companyId,
      actorUserId: context.actorUserId,
      action: input.action,
      entityType: input.entityType,
      ...(input.entityId === undefined ? {} : { entityId: input.entityId }),
      ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    },
  });
}
