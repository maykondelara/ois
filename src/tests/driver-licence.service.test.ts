/* eslint-disable no-unused-vars */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/modules/identity/tenant-context";
import { LicenceCrypto } from "@/modules/drivers/licence-crypto";
import { addDriverLicence } from "@/modules/drivers/driver-licence.service";

const context: TenantContext = {
  actorUserId: "admin-a",
  companyId: "company-a",
  membershipId: "membership-a",
  role: "ADMIN",
  permissions: new Set(["drivers.manage"]),
};

describe("driver licence service", () => {
  it("returns a redacted DTO and audits without crypto or plaintext material", async () => {
    let createData: Record<string, unknown> | undefined;
    let auditData: Record<string, unknown> | undefined;
    const transaction = {
      $executeRaw: async (_strings: TemplateStringsArray, ..._values: unknown[]) => 1,
      driver: {
        findUnique: async () => ({ id: "driver-a", companyId: "company-a", userId: null }),
      },
      driverLicence: {
        findUnique: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createData = data;
          return {
            id: "licence-a",
            ...data,
            issuingJurisdiction: null,
            issuedOn: null,
            expiresOn: new Date("2030-01-01"),
          };
        },
      },
      activity: {
        create: async ({ data }: { data: Record<string, unknown> }) => ((auditData = data), data),
      },
    };
    const client = {
      $transaction: async <T>(operation: (tx: typeof transaction) => Promise<T>) =>
        operation(transaction),
    };
    const result = await addDriverLicence(
      client as never,
      context,
      new LicenceCrypto({ rootKey: randomBytes(32), keyVersion: "test-v1" }),
      "driver-a",
      { licenceNumber: "ab-1234", expiresOn: "2030-01-01" },
    );
    expect(result).toMatchObject({ id: "licence-a", licenceNumberLast4: "1234" });
    expect(result).not.toHaveProperty("licenceNumberCiphertext");
    expect(result).not.toHaveProperty("licenceNumberLookupHash");
    expect(createData).toHaveProperty("licenceNumberCiphertext");
    expect(auditData).not.toHaveProperty("licenceNumberCiphertext");
    expect(JSON.stringify(auditData)).not.toContain("AB1234");
  });
});
