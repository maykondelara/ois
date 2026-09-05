/* eslint-disable no-unused-vars */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ValidationError } from "@/lib/errors";

const tokenVersion = 1;
const tokenLifetimeMs = 10 * 60 * 1000;
const tokenKeyBytes = 32;

export type OdometerConfirmationClaims = Readonly<{
  actorUserId: string;
  companyId: string;
  vehicleId: string;
  proposedKm: number;
  acceptedReadingId: string;
  acceptedOdometerKm: number;
  thresholdKm: number;
  issuedAt: number;
  expiresAt: number;
  version: number;
}>;

function parseKey(encoded: string | undefined): Buffer {
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded))
    throw new ValidationError(
      "INVALID_ODOMETER_CONFIRMATION_CONFIG",
      "Odometer confirmation key is invalid",
    );
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== tokenKeyBytes)
    throw new ValidationError(
      "INVALID_ODOMETER_CONFIRMATION_CONFIG",
      "Odometer confirmation key is invalid",
    );
  return key;
}

export function odometerConfirmationKeyFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Buffer {
  return parseKey(environment.OIS_ODOMETER_CONFIRMATION_KEY);
}

export function odometerConfirmationTokensFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  return new OdometerConfirmationTokenService(odometerConfirmationKeyFromEnvironment(environment));
}

function encode(payload: OdometerConfirmationClaims): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function sign(key: Uint8Array, encodedPayload: string): string {
  return createHmac("sha256", key).update(encodedPayload, "utf8").digest("base64url");
}

export class OdometerConfirmationTokenService {
  constructor(
    private readonly key: Uint8Array,
    private readonly now: () => number = Date.now,
  ) {}

  static forTests() {
    return new OdometerConfirmationTokenService(randomBytes(tokenKeyBytes));
  }

  issue(input: Omit<OdometerConfirmationClaims, "issuedAt" | "expiresAt" | "version">): string {
    const issuedAt = this.now();
    const payload: OdometerConfirmationClaims = {
      ...input,
      issuedAt,
      expiresAt: issuedAt + tokenLifetimeMs,
      version: tokenVersion,
    };
    const encodedPayload = encode(payload);
    return `${encodedPayload}.${sign(this.key, encodedPayload)}`;
  }

  verify(
    token: string,
    expected: Omit<OdometerConfirmationClaims, "issuedAt" | "expiresAt" | "version">,
  ) {
    const parts = token.split(".");
    if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part)))
      throw new ValidationError(
        "INVALID_ODOMETER_CONFIRMATION",
        "Odometer confirmation is invalid",
      );
    const [encodedPayload, suppliedSignature] = parts as [string, string];
    const expectedSignature = sign(this.key, encodedPayload);
    const supplied = Buffer.from(suppliedSignature, "base64url");
    const signature = Buffer.from(expectedSignature, "base64url");
    if (supplied.length !== signature.length || !timingSafeEqual(supplied, signature))
      throw new ValidationError(
        "INVALID_ODOMETER_CONFIRMATION",
        "Odometer confirmation is invalid",
      );
    let claims: OdometerConfirmationClaims;
    try {
      claims = JSON.parse(
        Buffer.from(encodedPayload, "base64url").toString("utf8"),
      ) as OdometerConfirmationClaims;
    } catch {
      throw new ValidationError(
        "INVALID_ODOMETER_CONFIRMATION",
        "Odometer confirmation is invalid",
      );
    }
    if (
      claims.version !== tokenVersion ||
      claims.expiresAt < this.now() ||
      claims.issuedAt > this.now() ||
      claims.actorUserId !== expected.actorUserId ||
      claims.companyId !== expected.companyId ||
      claims.vehicleId !== expected.vehicleId ||
      claims.proposedKm !== expected.proposedKm ||
      claims.acceptedReadingId !== expected.acceptedReadingId ||
      claims.acceptedOdometerKm !== expected.acceptedOdometerKm ||
      claims.thresholdKm !== expected.thresholdKm
    ) {
      throw new ValidationError("STALE_ODOMETER_CONFIRMATION", "Odometer confirmation is stale");
    }
    return claims;
  }
}
