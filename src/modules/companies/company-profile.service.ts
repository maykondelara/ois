import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { withTenantTransaction } from "@/db/tenant-transaction";
import { TenantRecordNotFoundError, ValidationError } from "@/lib/errors";
import { recordTenantActivity } from "@/modules/activities/audit.service";
import { requirePermission } from "@/modules/identity/authorization";
import type { TenantContext } from "@/modules/identity/tenant-context";

type TenantClient = Pick<PrismaClient, "$transaction">;
const updateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  timezone: z.string().trim().min(1).max(100),
});

function validateTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: timezone }).format(new Date());
  } catch {
    throw new ValidationError("INVALID_COMPANY_TIMEZONE", "Company timezone is invalid");
  }
}

export async function getCompanyProfile(client: TenantClient, context: TenantContext) {
  requirePermission(context, "company.read");
  return withTenantTransaction(client, context, async (transaction) => {
    const company = await transaction.company.findUnique({ where: { id: context.companyId } });
    if (!company) throw new TenantRecordNotFoundError("Company");
    return company;
  });
}

export async function updateCompanyProfile(
  client: TenantClient,
  context: TenantContext,
  rawInput: unknown,
) {
  requirePermission(context, "company.manage");
  const input = updateSchema.parse(rawInput);
  validateTimezone(input.timezone);
  return withTenantTransaction(client, context, async (transaction) => {
    const previous = await transaction.company.findUnique({ where: { id: context.companyId } });
    if (!previous) throw new TenantRecordNotFoundError("Company");
    const company = await transaction.company.update({
      where: { id: context.companyId },
      data: input,
    });
    await recordTenantActivity(transaction, context, {
      action: "company.profile_updated",
      entityType: "company",
      entityId: company.id,
      metadata: {
        previousName: previous.name,
        previousTimezone: previous.timezone,
        name: company.name,
        timezone: company.timezone,
      },
    });
    return company;
  });
}
