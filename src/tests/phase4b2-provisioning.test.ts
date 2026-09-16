/* eslint-disable no-unused-vars */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/modules/identity/tenant-context";
import {
  applyPilotProvisioning,
  pilotProvisioningCatalog,
  previewPilotProvisioning,
} from "@/modules/companies/pilot-provisioning.service";
import { getSetupReadiness } from "@/modules/companies/setup-readiness.service";

const owner: TenantContext = {
  actorUserId: "user-a",
  companyId: "company-a",
  membershipId: "membership-a",
  role: "OWNER",
  permissions: new Set([
    "company.read",
    "company.manage",
    "vehicles.manage",
    "compliance.manage",
    "inspections.configure",
  ]),
};

function memoryClient(seed?: { conflictingCategory?: boolean; foreignCategory?: boolean }) {
  let sequence = 0;
  const id = () => `id-${++sequence}`;
  const categories: Array<Record<string, any>> = seed?.conflictingCategory
    ? [
        {
          id: id(),
          companyId: "company-a",
          code: "VAN",
          name: "Customer Van",
          requiredLicenceClass: "C",
          isActive: true,
        },
      ]
    : [];
  if (seed?.foreignCategory)
    categories.push({
      id: id(),
      companyId: "company-b",
      code: "VAN",
      name: "Van",
      requiredLicenceClass: null,
      isActive: true,
    });
  const documentTypes: Array<Record<string, any>> = [];
  const requirements: Array<Record<string, any>> = [];
  const templates: Array<Record<string, any>> = [];
  const versions: Array<Record<string, any>> = [];
  const sections: Array<Record<string, any>> = [];
  const questions: Array<Record<string, any>> = [];
  const audits: Array<Record<string, any>> = [];
  const companyMatches = (record: Record<string, any>, companyId: string) =>
    record.companyId === companyId;
  const textMatch = (record: Record<string, any>, clauses: Array<Record<string, any>>) =>
    clauses.some((clause) =>
      clause.code
        ? record.code === clause.code
        : record.name.toLowerCase() === clause.name.equals.toLowerCase(),
    );
  const transaction = {
    $executeRaw: async () => 1,
    company: {
      findUnique: async () => ({
        id: "company-a",
        name: "Pilot Transport",
        timezone: "Australia/Perth",
      }),
    },
    companyOperationalSettings: { findUnique: async () => null },
    driver: { count: async () => 0 },
    vehicle: { count: async () => 0 },
    vehicleCategory: {
      findMany: async ({ where }: any) =>
        categories.filter(
          (record) => companyMatches(record, where.companyId) && textMatch(record, where.OR),
        ),
      create: async ({ data }: any) => {
        const record = { id: id(), isActive: true, ...data };
        categories.push(record);
        return record;
      },
      count: async ({ where }: any) =>
        categories.filter(
          (record) => record.companyId === where.companyId && record.isActive === where.isActive,
        ).length,
    },
    documentType: {
      findMany: async ({ where }: any) =>
        documentTypes.filter(
          (record) => companyMatches(record, where.companyId) && textMatch(record, where.OR),
        ),
      findUnique: async ({ where }: any) =>
        documentTypes.find(
          (record) =>
            record.companyId === where.companyId_code.companyId &&
            record.code === where.companyId_code.code,
        ) ?? null,
      create: async ({ data }: any) => {
        const record = { id: id(), isActive: true, ...data };
        documentTypes.push(record);
        return record;
      },
    },
    complianceRequirement: {
      findMany: async ({ where }: any) =>
        requirements.filter(
          (record) =>
            record.companyId === where.companyId &&
            record.documentTypeId === where.documentTypeId &&
            record.isActive === where.isActive,
        ),
      create: async ({ data }: any) => {
        const record = { id: id(), isActive: true, ...data };
        requirements.push(record);
        return record;
      },
      count: async ({ where }: any) =>
        requirements.filter(
          (record) => record.companyId === where.companyId && record.isActive === where.isActive,
        ).length,
    },
    inspectionTemplate: {
      findMany: async ({ where }: any) =>
        templates.filter(
          (record) => companyMatches(record, where.companyId) && textMatch(record, where.OR),
        ),
      create: async ({ data }: any) => {
        const record = {
          id: id(),
          isActive: true,
          currentPublishedVersionId: null,
          ...data,
        };
        templates.push(record);
        return record;
      },
      update: async ({ where, data }: any) => {
        const record = templates.find((item) => item.id === where.companyId_id.id)!;
        Object.assign(record, data);
        return record;
      },
      count: async ({ where }: any) =>
        templates.filter(
          (record) =>
            record.companyId === where.companyId &&
            record.isActive === where.isActive &&
            record.currentPublishedVersionId !== null,
        ).length,
    },
    inspectionTemplateVersion: {
      create: async ({ data }: any) => {
        const record = { id: id(), status: "DRAFT", ...data };
        versions.push(record);
        return record;
      },
      update: async ({ where, data }: any) => {
        const record = versions.find((item) => item.id === where.companyId_id.id)!;
        Object.assign(record, data);
        return record;
      },
    },
    inspectionSection: {
      findMany: async ({ where }: any) =>
        sections
          .filter(
            (record) =>
              record.companyId === where.companyId &&
              record.templateVersionId === where.templateVersionId &&
              record.isActive === where.isActive,
          )
          .sort((a, b) => a.sortOrder - b.sortOrder),
      create: async ({ data }: any) => {
        const record = { id: id(), isActive: true, ...data };
        sections.push(record);
        return record;
      },
    },
    inspectionQuestion: {
      findMany: async ({ where }: any) =>
        questions
          .filter(
            (record) =>
              record.companyId === where.companyId &&
              record.templateVersionId === where.templateVersionId &&
              record.isActive === where.isActive,
          )
          .sort((a, b) => a.sortOrder - b.sortOrder),
      create: async ({ data }: any) => {
        const record = { id: id(), isActive: true, ...data };
        questions.push(record);
        return record;
      },
    },
    activity: {
      create: async ({ data }: any) => {
        audits.push(data);
        return data;
      },
    },
  };
  return {
    client: {
      $transaction: async <T>(operation: (tx: typeof transaction) => Promise<T>) =>
        operation(transaction),
    },
    state: { categories, documentTypes, requirements, templates, sections, questions, audits },
  };
}

describe("Phase 4B.2 guided pilot provisioning", () => {
  it("previews without mutation and keeps every selector tenant-scoped", async () => {
    const fixture = memoryClient({ foreignCategory: true });
    const before = JSON.stringify(fixture.state);
    const result = await previewPilotProvisioning(fixture.client as never, owner, {
      componentIds: ["category.van", "compliance.vehicle_registration"],
    });
    expect(result.filter((item) => item.status === "CREATE")).toHaveLength(2);
    expect(JSON.stringify(fixture.state)).toBe(before);
  });

  it("requires explicit confirmation and denies DRIVER before a transaction", async () => {
    const transaction = vi.fn();
    await expect(
      applyPilotProvisioning({ $transaction: transaction } as never, owner, {
        componentIds: ["category.van"],
        confirmed: false,
        preview: [],
      }),
    ).rejects.toMatchObject({ code: "PROVISIONING_CONFIRMATION_REQUIRED" });
    await expect(
      previewPilotProvisioning(
        { $transaction: transaction } as never,
        {
          ...owner,
          role: "DRIVER",
          permissions: new Set([]),
        },
        { componentIds: [] },
      ),
    ).rejects.toMatchObject({ name: "AuthorizationError" });
    expect(transaction).not.toHaveBeenCalled();
    await expect(
      applyPilotProvisioning(memoryClient().client as never, owner, {
        componentIds: ["category.van"],
        confirmed: true,
        preview: [],
      }),
    ).rejects.toMatchObject({ code: "PROVISIONING_PREVIEW_STALE" });
  });

  it("applies atomically, audits outcomes and is idempotent on repetition", async () => {
    const fixture = memoryClient();
    const input = {
      componentIds: [
        "category.van",
        "compliance.vehicle_registration",
        "inspection.basic_prestart",
      ],
      confirmed: true,
      preview: [] as Array<{ id: string; status: "CREATE" | "ALREADY_PRESENT" | "CONFLICT" }>,
    };
    const initialPreview = await previewPilotProvisioning(fixture.client as never, owner, input);
    input.preview = initialPreview
      .filter((item) => input.componentIds.includes(item.id))
      .map(({ id, status }) => ({
        id,
        status: status as "CREATE" | "ALREADY_PRESENT" | "CONFLICT",
      }));
    const first = await applyPilotProvisioning(fixture.client as never, owner, input);
    expect(first.filter((item) => item.status === "CREATE")).toHaveLength(3);
    const counts = {
      categories: fixture.state.categories.length,
      requirements: fixture.state.requirements.length,
      templates: fixture.state.templates.length,
      questions: fixture.state.questions.length,
    };
    const repeatedPreview = await previewPilotProvisioning(fixture.client as never, owner, input);
    input.preview = repeatedPreview
      .filter((item) => input.componentIds.includes(item.id))
      .map(({ id, status }) => ({
        id,
        status: status as "CREATE" | "ALREADY_PRESENT" | "CONFLICT",
      }));
    const second = await applyPilotProvisioning(fixture.client as never, owner, input);
    expect(second.filter((item) => item.status === "ALREADY_PRESENT")).toHaveLength(3);
    expect({
      categories: fixture.state.categories.length,
      requirements: fixture.state.requirements.length,
      templates: fixture.state.templates.length,
      questions: fixture.state.questions.length,
    }).toEqual(counts);
    expect(fixture.state.audits).toHaveLength(2);
    expect(fixture.state.audits[0]).toMatchObject({
      companyId: "company-a",
      actorUserId: "user-a",
      action: "company.pilot_provisioning_applied",
    });
    await expect(getSetupReadiness(fixture.client as never, owner)).resolves.toMatchObject({
      state: "IN_PROGRESS",
      checks: {
        vehicleCategory: true,
        complianceRequirement: true,
        publishedInspection: true,
        driver: false,
        vehicle: false,
      },
    });
  });

  it("reports ambiguous customer configuration as conflict without overwriting it", async () => {
    const fixture = memoryClient({ conflictingCategory: true });
    const original = { ...fixture.state.categories[0] };
    const preview = await previewPilotProvisioning(fixture.client as never, owner, {
      componentIds: ["category.van"],
    });
    const result = await applyPilotProvisioning(fixture.client as never, owner, {
      componentIds: ["category.van"],
      confirmed: true,
      preview: preview
        .filter((item) => item.id === "category.van")
        .map(({ id, status }) => ({
          id,
          status: status as "CREATE" | "ALREADY_PRESENT" | "CONFLICT",
        })),
    });
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "category.van", status: "CONFLICT" })]),
    );
    expect(fixture.state.categories).toHaveLength(1);
    expect(fixture.state.categories[0]).toEqual(original);
  });

  it("keeps starter content English and exposes no storage or crypto internals", () => {
    const serialized = JSON.stringify(pilotProvisioningCatalog());
    expect(serialized).not.toMatch(/[áéíóúãõç]/i);
    expect(serialized).not.toMatch(/cipher|lookupHash|objectKey|bucket|storageProvider/i);
    expect(serialized).toContain("Basic vehicle pre-start inspection");
    const root = process.cwd();
    const applyRoute = fs.readFileSync(
      path.join(root, "src/app/api/companies/[companyId]/setup/provisioning/apply/route.ts"),
      "utf8",
    );
    expect(applyRoute).toContain("getSetupReadiness");
  });
});
