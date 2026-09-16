import { describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  AuthorizationError,
  TenantContextUnavailableError,
} from "@/lib/errors";

const context = {
  actorUserId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "ADMIN" as const,
  permissions: new Set(["drivers.read", "drivers.manage"]),
};
const listDriversPage = vi.fn();
const requireTenantContext = vi.fn(async () => context);

vi.mock("@/auth/context", () => ({ requireTenantContext }));
vi.mock("@/db/prisma", () => ({ prisma: {} }));
vi.mock("@/modules/drivers/driver.service", () => ({
  listDriversPage,
  createDriver: vi.fn(),
}));

const driversRoute = await import("@/app/api/companies/[companyId]/drivers/route");

const params = Promise.resolve({ companyId: context.companyId });

describe("driver list route", () => {
  it("passes only bounded, approved filters to the tenant-aware page service", async () => {
    listDriversPage.mockResolvedValueOnce({
      data: [
        {
          id: "driver-a",
          displayName: "Driver A",
          phoneE164: null,
          operationalStatus: "ACTIVE",
          depotLocationId: null,
          userId: null,
          emergencyContactName: null,
          emergencyContactPhoneE164: null,
        },
      ],
      hasNextPage: true,
    });
    const response = await driversRoute.GET(
      new Request(
        `https://ois.test/api/companies/${context.companyId}/drivers?page=2&pageSize=25&status=ACTIVE&linked=false&q=Driver`,
      ),
      { params },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      capabilities: { canManage: true },
      data: [
        {
          id: "driver-a",
          displayName: "Driver A",
          phoneE164: null,
          operationalStatus: "ACTIVE",
          depotLocationId: null,
          linkedUser: false,
          emergencyContactName: null,
          emergencyContactPhoneE164: null,
        },
      ],
      page: { number: 2, pageSize: 25, hasNextPage: true },
    });
    expect(listDriversPage).toHaveBeenCalledWith(
      {},
      context,
      expect.objectContaining({
        page: 2,
        pageSize: 25,
        q: "Driver",
        status: "ACTIVE",
        linked: false,
      }),
    );
  });

  it("returns a safe 400 envelope for malformed tenant path input before invoking services", async () => {
    const response = await driversRoute.GET(
      new Request("https://ois.test/api/companies/not-a-uuid/drivers"),
      {
        params: Promise.resolve({ companyId: "not-a-uuid" }),
      },
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatchObject({ code: "INVALID_PATH" });
  });

  it("maps a service capability denial without leaking implementation details", async () => {
    listDriversPage.mockRejectedValueOnce(
      new AuthorizationError("Missing permission: drivers.read"),
    );
    const response = await driversRoute.GET(
      new Request(`https://ois.test/api/companies/${context.companyId}/drivers`),
      { params },
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatchObject({
      code: "PERMISSION_DENIED",
      message: "Access is denied",
    });
  });

  it("keeps 401, tenant-selection 404, and post-context capability 403 distinct", async () => {
    requireTenantContext.mockRejectedValueOnce(new AuthenticationError());
    const unauthenticated = await driversRoute.GET(
      new Request(`https://ois.test/api/companies/${context.companyId}/drivers`),
      { params },
    );
    expect(unauthenticated.status).toBe(401);

    requireTenantContext.mockRejectedValueOnce(new TenantContextUnavailableError());
    const unavailableTenant = await driversRoute.GET(
      new Request(`https://ois.test/api/companies/${context.companyId}/drivers`),
      { params },
    );
    expect(unavailableTenant.status).toBe(404);
    expect((await unavailableTenant.json()).error).toMatchObject({
      code: "TENANT_RESOURCE_NOT_FOUND",
      message: "Tenant resource not found",
    });

    listDriversPage.mockRejectedValueOnce(
      new AuthorizationError("Missing permission: drivers.read"),
    );
    const capabilityDenied = await driversRoute.GET(
      new Request(`https://ois.test/api/companies/${context.companyId}/drivers`),
      { params },
    );
    expect(capabilityDenied.status).toBe(403);
  });
});
