import type { TenantTransaction } from "@/db/tenant-transaction";
import type { TenantContext } from "@/modules/identity/tenant-context";

/** The repository accepts an already-authorised tenant transaction, never a caller-provided company ID. */
export const locationRepository = {
  list(transaction: TenantTransaction, context: TenantContext) {
    return transaction.location.findMany({
      where: { companyId: context.companyId },
      orderBy: { name: "asc" },
    });
  },
  create(
    transaction: TenantTransaction,
    context: TenantContext,
    input: { name: string; address?: string },
  ) {
    return transaction.location.create({
      data: {
        companyId: context.companyId,
        name: input.name,
        ...(input.address === undefined ? {} : { address: input.address }),
      },
    });
  },
};
