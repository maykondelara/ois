/* eslint-disable no-unused-vars */
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/modules/identity/tenant-context";
import { LicenceCrypto } from "@/modules/drivers/licence-crypto";
import { addDriverLicence, renewDriverLicence } from "@/modules/drivers/driver-licence.service";

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
      $queryRaw: async () => [],
      driver: {
        findUnique: async () => ({ id: "driver-a", companyId: "company-a", userId: null }),
      },
      driverLicence: {
        findUnique: async () => null,
        findFirst: async () => null,
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

  it("maps a direct-successor P2002 target to a renewal conflict", async () => {
    const failure = Object.assign(new Error("unique"), {
      code: "P2002",
      meta: { target: ["company_id", "replaces_licence_id"] },
    });
    const transaction = renewalFailureTransaction(failure);
    const client = {
      $transaction: async <T>(operation: (tx: typeof transaction) => Promise<T>) =>
        operation(transaction),
    };

    await expect(
      renewDriverLicence(
        client as never,
        context,
        new LicenceCrypto({ rootKey: randomBytes(32), keyVersion: "test-v1" }),
        "driver-a",
        "predecessor-a",
        renewalInput(),
      ),
    ).rejects.toMatchObject({ code: "LICENCE_RENEWAL_CONFLICT" });
  });

  it("classifies a null-target P2002 from a committed direct successor", async () => {
    const failure = Object.assign(new Error("unique"), { code: "P2002", meta: { target: null } });
    const mutationTransaction = renewalFailureTransaction(failure);
    const inspectionTransaction = {
      $executeRaw: async () => 1,
      driverLicence: {
        findFirst: async ({ where }: { where: { replacesLicenceId?: string } }) =>
          where.replacesLicenceId ? { id: "committed-successor" } : null,
      },
    };
    const client = sequentialTransactionClient(mutationTransaction, inspectionTransaction);

    await expect(
      renewDriverLicence(
        client as never,
        context,
        new LicenceCrypto({ rootKey: randomBytes(32), keyVersion: "test-v1" }),
        "driver-a",
        "predecessor-a",
        renewalInput(),
      ),
    ).rejects.toMatchObject({ code: "LICENCE_RENEWAL_CONFLICT" });
  });

  it("keeps a null-target P2002 with a committed licence-number duplicate classified as duplicate", async () => {
    const failure = Object.assign(new Error("unique"), { code: "P2002", meta: { target: null } });
    const mutationTransaction = renewalFailureTransaction(failure);
    const inspectionTransaction = {
      $executeRaw: async () => 1,
      driverLicence: {
        findFirst: async ({ where }: { where: { replacesLicenceId?: string } }) =>
          where.replacesLicenceId ? { id: "also-a-successor" } : { id: "same-number-licence" },
      },
    };
    const client = sequentialTransactionClient(mutationTransaction, inspectionTransaction);

    await expect(
      renewDriverLicence(
        client as never,
        context,
        new LicenceCrypto({ rootKey: randomBytes(32), keyVersion: "test-v1" }),
        "driver-a",
        "predecessor-a",
        renewalInput(),
      ),
    ).rejects.toMatchObject({ code: "DUPLICATE_LICENCE" });
  });

  it("maps an exclusion-constraint race to a cross-driver duplicate", async () => {
    const failure = Object.assign(new Error("exclusion"), {
      code: "P2004",
      meta: { target: null },
    });
    const mutationTransaction = renewalFailureTransaction(failure);
    const inspectionTransaction = {
      $executeRaw: async () => 1,
      driverLicence: {
        findFirst: async () => ({ id: "other-driver-licence" }),
      },
    };
    const client = sequentialTransactionClient(mutationTransaction, inspectionTransaction);

    await expect(
      renewDriverLicence(
        client as never,
        context,
        new LicenceCrypto({ rootKey: randomBytes(32), keyVersion: "test-v1" }),
        "driver-a",
        "predecessor-a",
        renewalInput(),
      ),
    ).rejects.toMatchObject({ code: "DUPLICATE_LICENCE" });
  });

  it("classifies the known exclusion constraint from PrismaClientUnknownRequestError", async () => {
    const failure = new Prisma.PrismaClientUnknownRequestError(
      'conflicting key value violates exclusion constraint "driver_licences_company_hash_different_driver_excl"',
      { clientVersion: "6.19.0" },
    );
    const mutationTransaction = licenceCreateFailureTransaction(failure);
    const inspectionTransaction = {
      $executeRaw: async () => 1,
      driverLicence: { findFirst: async () => ({ id: "other-driver-licence" }) },
    };
    const client = sequentialTransactionClient(mutationTransaction as never, inspectionTransaction);

    await expect(
      addDriverLicence(
        client as never,
        context,
        new LicenceCrypto({ rootKey: randomBytes(32), keyVersion: "test-v1" }),
        "driver-a",
        { licenceNumber: "UNKNOWN-EXCLUSION-1234", expiresOn: "2030-01-01" },
      ),
    ).rejects.toMatchObject({ code: "DUPLICATE_LICENCE" });
  });

  it("rethrows an unrelated PrismaClientUnknownRequestError", async () => {
    const failure = new Prisma.PrismaClientUnknownRequestError("unexpected database failure", {
      clientVersion: "6.19.0",
    });
    const transaction = licenceCreateFailureTransaction(failure);
    const client = {
      $transaction: async <T>(operation: (tx: typeof transaction) => Promise<T>) =>
        operation(transaction),
    };

    await expect(
      addDriverLicence(
        client as never,
        context,
        new LicenceCrypto({ rootKey: randomBytes(32), keyVersion: "test-v1" }),
        "driver-a",
        { licenceNumber: "UNKNOWN-NONEXCLUSION-1234", expiresOn: "2030-01-01" },
      ),
    ).rejects.toBe(failure);
  });

  it("permits explicit renewal with the predecessor's normalized licence number", async () => {
    const transaction = {
      $executeRaw: async () => 1,
      $queryRaw: async () => [{ id: "driver-a" }],
      driver: {
        findUnique: async () => ({ id: "driver-a", companyId: "company-a", userId: null }),
      },
      driverLicence: {
        findUnique: async () => ({ id: "predecessor-a", driverId: "driver-a", validFrom: null }),
        findFirst: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => ({
          id: "successor-a",
          ...data,
          issuingJurisdiction: null,
          issuedOn: null,
          expiresOn: new Date("2032-01-01"),
        }),
      },
      activity: { create: async ({ data }: { data: unknown }) => data },
    };
    const client = {
      $transaction: async <T>(operation: (tx: typeof transaction) => Promise<T>) =>
        operation(transaction),
    };

    await expect(
      renewDriverLicence(
        client as never,
        context,
        new LicenceCrypto({ rootKey: randomBytes(32), keyVersion: "test-v1" }),
        "driver-a",
        "predecessor-a",
        { ...renewalInput(), licenceNumber: "SAME-1234" },
      ),
    ).resolves.toMatchObject({ id: "successor-a" });
  });
});

function renewalInput() {
  return {
    licenceNumber: "NEW-1234",
    licenceClass: "HR" as const,
    validFrom: "2027-01-01",
    expiresOn: "2032-01-01",
  };
}

function renewalFailureTransaction(failure: Error & { code: string; meta: { target: unknown } }) {
  return {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ id: "predecessor-a" }],
    driver: {
      findUnique: async () => ({ id: "driver-a", companyId: "company-a", userId: null }),
    },
    driverLicence: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) =>
        "companyId_id" in where
          ? { id: "predecessor-a", driverId: "driver-a", validFrom: null }
          : null,
      findFirst: async () => null,
      create: async () => {
        throw failure;
      },
    },
  };
}

function licenceCreateFailureTransaction(failure: Error) {
  return {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ id: "driver-a" }],
    driver: {
      findUnique: async () => ({ id: "driver-a", companyId: "company-a", userId: null }),
    },
    driverLicence: {
      findFirst: async () => null,
      create: async () => {
        throw failure;
      },
    },
  };
}

function sequentialTransactionClient(
  mutationTransaction: ReturnType<typeof renewalFailureTransaction>,
  inspectionTransaction: {
    $executeRaw: () => Promise<number>;
    driverLicence: {
      findFirst: (input: {
        where: { replacesLicenceId?: string };
      }) => Promise<{ id: string } | null>;
    };
  },
) {
  let invocation = 0;
  return {
    $transaction: async <T>(operation: (tx: typeof mutationTransaction) => Promise<T>) => {
      invocation += 1;
      return operation((invocation === 1 ? mutationTransaction : inspectionTransaction) as never);
    },
  };
}
