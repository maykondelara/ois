import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { ValidationError } from "@/lib/errors";

const nonceBytes = 12;
const tagBytes = 16;
const derivedKeyBytes = 32;

export type LicenceCryptoConfig = Readonly<{ rootKey: Uint8Array; keyVersion: string }>;
export type EncryptedLicence = Readonly<{ ciphertext: string; keyVersion: string }>;

function derive(rootKey: Uint8Array, label: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", rootKey, Buffer.alloc(0), Buffer.from(label), derivedKeyBytes),
  );
}

function aad(companyId: string, driverId: string, keyVersion: string): Buffer {
  return Buffer.from(`ois/licence/${keyVersion}\u0000${companyId}\u0000${driverId}`, "utf8");
}

function parseRootKey(encoded: string | undefined): Uint8Array {
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded))
    throw new ValidationError("INVALID_LICENCE_CRYPTO_CONFIG", "Licence encryption key is invalid");
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== derivedKeyBytes)
    throw new ValidationError("INVALID_LICENCE_CRYPTO_CONFIG", "Licence encryption key is invalid");
  return key;
}

export function licenceCryptoConfigFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): LicenceCryptoConfig {
  const keyVersion = environment.OIS_LICENCE_ENCRYPTION_KEY_VERSION;
  if (!keyVersion || !/^[A-Za-z0-9._-]{1,32}$/.test(keyVersion))
    throw new ValidationError(
      "INVALID_LICENCE_CRYPTO_CONFIG",
      "Licence encryption key version is invalid",
    );
  return { rootKey: parseRootKey(environment.OIS_LICENCE_ENCRYPTION_KEY), keyVersion };
}

export function licenceCryptoFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  return new LicenceCrypto(licenceCryptoConfigFromEnvironment(environment));
}

/** Server-only authenticated encryption and tenant-scoped duplicate lookup. */
export class LicenceCrypto {
  private readonly encryptionKey: Buffer;
  private readonly lookupKey: Buffer;

  constructor(private readonly config: LicenceCryptoConfig) {
    this.encryptionKey = derive(config.rootKey, `ois/licence/encryption/${config.keyVersion}`);
    this.lookupKey = derive(config.rootKey, `ois/licence/lookup/${config.keyVersion}`);
  }

  encrypt(companyId: string, driverId: string, plaintext: string): EncryptedLicence {
    const nonce = randomBytes(nonceBytes);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, nonce, {
      authTagLength: tagBytes,
    });
    cipher.setAAD(aad(companyId, driverId, this.config.keyVersion));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: [nonce, tag, ciphertext].map((part) => part.toString("base64url")).join("."),
      keyVersion: this.config.keyVersion,
    };
  }

  decrypt(companyId: string, driverId: string, encrypted: EncryptedLicence): string {
    if (encrypted.keyVersion !== this.config.keyVersion)
      throw new ValidationError(
        "UNKNOWN_LICENCE_KEY_VERSION",
        "Licence key version is unavailable",
      );
    const parts = encrypted.ciphertext.split(".");
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part)))
      throw new ValidationError("INVALID_LICENCE_CIPHERTEXT", "Licence ciphertext is invalid");
    const [noncePart, tagPart, ciphertextPart] = parts as [string, string, string];
    const nonce = Buffer.from(noncePart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    if (nonce.length !== nonceBytes || tag.length !== tagBytes)
      throw new ValidationError("INVALID_LICENCE_CIPHERTEXT", "Licence ciphertext is invalid");
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, nonce, {
      authTagLength: tagBytes,
    });
    decipher.setAAD(aad(companyId, driverId, encrypted.keyVersion));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  lookupHash(companyId: string, normalizedLicenceNumber: string): Buffer {
    return createHmac("sha256", this.lookupKey)
      .update(companyId, "utf8")
      .update("\u0000", "utf8")
      .update(normalizedLicenceNumber, "utf8")
      .digest();
  }
}

/** Used only by token tests to ensure timing-safe comparisons remain explicit. */
export function equalLicenceLookupHashes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}
