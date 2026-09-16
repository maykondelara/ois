import { describe, expect, it, vi } from "vitest";
import { ConflictError, TenantContextUnavailableError } from "@/lib/errors";

const context = {
  actorUserId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "MANAGER" as const,
  permissions: new Set(["issues.read", "issues.manage", "issues.resolve", "vehicles.release"]),
};
const issueId = "44444444-4444-4444-8444-444444444444";
const vehicleId = "55555555-5555-4555-8555-555555555555";
const requireTenantContext = vi.fn(async () => context);
const listIssuesPage = vi.fn();
const getIssue = vi.fn();
const addIssueAction = vi.fn();
const startIssueProgress = vi.fn();
const resolveIssue = vi.fn();
const closeIssue = vi.fn();
const reclassifyIssueSeverity = vi.fn();
const releaseVehicleFromResolvedIssues = vi.fn();

vi.mock("@/auth/context", () => ({ requireTenantContext }));
vi.mock("@/db/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/issues/issue.service", () => ({
  listIssuesPage,
  getIssue,
  addIssueAction,
  startIssueProgress,
  resolveIssue,
  closeIssue,
  reclassifyIssueSeverity,
  releaseVehicleFromResolvedIssues,
}));

const listRoute = await import("@/app/api/companies/[companyId]/issues/route");
const detailRoute = await import("@/app/api/companies/[companyId]/issues/[issueId]/route");
const actionRoute = await import("@/app/api/companies/[companyId]/issues/[issueId]/actions/route");
const resolveRoute = await import("@/app/api/companies/[companyId]/issues/[issueId]/resolve/route");
const releaseRoute =
  await import("@/app/api/companies/[companyId]/vehicles/[vehicleId]/release/route");
const params = Promise.resolve({ companyId: context.companyId });
const issueParams = Promise.resolve({ companyId: context.companyId, issueId });
const vehicleParams = Promise.resolve({ companyId: context.companyId, vehicleId });
const issue = {
  id: issueId,
  companyId: context.companyId,
  vehicleId,
  inspectionSubmissionId: "submission-a",
  inspectionResponseId: "response-a",
  inspectionTemplateVersionId: "version-a",
  inspectionQuestionId: "question-a",
  operationalImpact: "VEHICLE_BLOCKING",
  severity: "HIGH",
  status: "OPEN",
  vehicleRegistrationSnapshot: "TRUCK1",
  templateNameSnapshot: "Pre-start",
  questionLabelSnapshot: "Brakes",
  createdByUserId: context.actorUserId,
  createdAt: new Date(),
  resolvedByUserId: null,
  resolvedAt: null,
  resolutionNotes: null,
  closedByUserId: null,
  closedAt: null,
  updatedAt: new Date(),
};
const request = (path: string, body: unknown) =>
  new Request(`https://ois.test${path}`, {
    method: "POST",
    headers: { origin: "https://ois.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("Phase 3D.2 issue routes", () => {
  it("passes only bounded issue filters to the tenant service", async () => {
    listIssuesPage.mockResolvedValueOnce({ data: [issue], hasNextPage: false });
    const response = await listRoute.GET(
      new Request(
        `https://ois.test/api/companies/${context.companyId}/issues?page=2&pageSize=10&status=OPEN&severity=HIGH&blocking=true&vehicleId=${vehicleId}`,
      ),
      { params },
    );
    expect(response.status).toBe(200);
    expect(listIssuesPage).toHaveBeenCalledWith(
      {},
      context,
      { number: 2, pageSize: 10 },
      { status: "OPEN", severity: "HIGH", operationalImpact: "VEHICLE_BLOCKING", vehicleId },
    );
    expect((await response.json()).data[0]).toMatchObject({ isVehicleBlocking: true });
  });

  it("loads issue detail through the scoped domain read service", async () => {
    getIssue.mockResolvedValueOnce({
      issue,
      vehicle: {
        id: vehicleId,
        registrationDisplay: "TRUCK1",
        operationalStatus: "OUT_OF_SERVICE",
      },
      history: [],
      actions: [],
      holds: [],
    });
    const response = await detailRoute.GET(
      new Request(`https://ois.test/api/companies/${context.companyId}/issues/${issueId}`),
      { params: issueParams },
    );
    expect(response.status).toBe(200);
    expect(getIssue).toHaveBeenCalledWith({}, context, issueId);
    expect((await response.json()).data.vehicle.operationalStatus).toBe("OUT_OF_SERVICE");
  });

  it("delegates append-only action and explicit resolution inputs", async () => {
    addIssueAction.mockResolvedValueOnce({
      id: "action-a",
      companyId: context.companyId,
      issueId,
      actionType: "REPAIR",
      description: "Replaced hose",
      notes: null,
      actorUserId: context.actorUserId,
      occurredAt: new Date(),
      createdAt: new Date(),
    });
    resolveIssue.mockResolvedValueOnce({
      ...issue,
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolutionNotes: "Pressure tested",
    });
    const action = await actionRoute.POST(
      request(`/api/companies/${context.companyId}/issues/${issueId}/actions`, {
        actionType: "REPAIR",
        description: "Replaced hose",
      }),
      { params: issueParams },
    );
    const resolved = await resolveRoute.POST(
      request(`/api/companies/${context.companyId}/issues/${issueId}/resolve`, {
        resolutionNotes: "Pressure tested",
      }),
      { params: issueParams },
    );
    expect(action.status).toBe(201);
    expect(resolved.status).toBe(200);
    expect(addIssueAction).toHaveBeenCalledWith({}, context, issueId, {
      actionType: "REPAIR",
      description: "Replaced hose",
    });
    expect(resolveIssue).toHaveBeenCalledWith({}, context, issueId, "Pressure tested");
  });

  it("maps accepted release conflicts to an actionable 409 envelope", async () => {
    releaseVehicleFromResolvedIssues.mockRejectedValueOnce(
      new ConflictError(
        "VEHICLE_BLOCKING_ISSUES_REMAIN",
        "Vehicle still has unresolved blocking issues",
      ),
    );
    const response = await releaseRoute.POST(
      request(`/api/companies/${context.companyId}/vehicles/${vehicleId}/release`, {
        reason: "Checked",
      }),
      { params: vehicleParams },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({
      code: "VEHICLE_BLOCKING_ISSUES_REMAIN",
      message: "Vehicle still has unresolved blocking issues",
    });
  });

  it("conceals an unauthorized company selector as not found", async () => {
    requireTenantContext.mockRejectedValueOnce(new TenantContextUnavailableError());
    const response = await listRoute.GET(
      new Request(`https://ois.test/api/companies/${context.companyId}/issues`),
      { params },
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("TENANT_RESOURCE_NOT_FOUND");
  });
});
