import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LicenceCrypto,
  licenceCryptoConfigFromEnvironment,
} from "@/modules/drivers/licence-crypto";
import { licenceLastFour, normalizeLicenceNumber } from "@/modules/drivers/licence-normalization";

function crypto() {
  return new LicenceCrypto({ rootKey: randomBytes(32), keyVersion: "test-v1" });
}

describe("LicenceCrypto", () => {
  it("normalizes, encrypts, and decrypts only with the bound company and driver", () => {
    const service = crypto();
    const normalized = normalizeLicenceNumber(" ab-12 34 ");
    const encrypted = service.encrypt("company-a", "driver-a", normalized);
    expect(normalized).toBe("AB1234");
    expect(licenceLastFour(normalized)).toBe("1234");
    expect(encrypted.ciphertext).not.toContain(normalized);
    expect(service.decrypt("company-a", "driver-a", encrypted)).toBe(normalized);
    expect(() => service.decrypt("company-b", "driver-a", encrypted)).toThrow();
    expect(() => service.decrypt("company-a", "driver-b", encrypted)).toThrow();
  });

  it("uses a tenant-scoped lookup hash and rejects tampered ciphertext", () => {
    const service = crypto();
    const normalized = normalizeLicenceNumber("AB-1234");
    expect(service.lookupHash("company-a", normalized)).not.toEqual(
      service.lookupHash("company-b", normalized),
    );
    const encrypted = service.encrypt("company-a", "driver-a", normalized);
    const [nonce, tag, ciphertext] = encrypted.ciphertext.split(".") as [string, string, string];
    const tampered = {
      ...encrypted,
      ciphertext: `${nonce}.${tag}.${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`,
    };
    expect(() => service.decrypt("company-a", "driver-a", tampered)).toThrow();
  });

  it("requires a base64url 32-byte server key and explicit key version", () => {
    expect(() =>
      licenceCryptoConfigFromEnvironment({ OIS_LICENCE_ENCRYPTION_KEY_VERSION: "v1" }),
    ).toThrow();
    expect(() =>
      licenceCryptoConfigFromEnvironment({
        OIS_LICENCE_ENCRYPTION_KEY: "abc",
        OIS_LICENCE_ENCRYPTION_KEY_VERSION: "v1",
      }),
    ).toThrow();
  });
});
