import { prisma } from "@/db/prisma";
import { readJson, tenantRoute } from "@/lib/http/api";
import {
  getCompanyProfile,
  updateCompanyProfile,
} from "@/modules/companies/company-profile.service";

const dto = (company: {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  status: string;
}) => ({
  id: company.id,
  name: company.name,
  slug: company.slug,
  timezone: company.timezone,
  status: company.status,
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  return tenantRoute(request, await params, async (context) => ({
    data: dto(await getCompanyProfile(prisma, context)),
    capabilities: { canManage: context.permissions.has("company.manage") },
  }));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> },
) {
  return tenantRoute(request, await params, async (context) => ({
    data: dto(await updateCompanyProfile(prisma, context, await readJson(request))),
  }));
}
