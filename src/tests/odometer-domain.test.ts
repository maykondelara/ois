import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import {
  OdometerConfirmationTokenService,
  odometerConfirmationKeyFromEnvironment,
} from "@/modules/vehicles/odometer-confirmation";
import {
  decideOdometerSubmission,
  kilometresRemaining,
} from "@/modules/vehicles/odometer-decision";
import { validateManualVehicleStatusTransition } from "@/modules/vehicles/vehicle-status";

const accepted = { id: "reading-a", readingKm: 184_320 };

describe("odometer domain rules", () => {
  it("classifies authoritative odometer decisions without mutating state", () => {
    expect(
      decideOdometerSubmission({
        proposedKm: 184_515,
        thresholdKm: 1_000,
        latestAccepted: accepted,
        hasPendingReview: false,
      }),
    ).toMatchObject({ kind: "ACCEPT", differenceKm: 195 });
    expect(
      decideOdometerSubmission({
        proposedKm: 194_515,
        thresholdKm: 1_000,
        latestAccepted: accepted,
        hasPendingReview: false,
      }),
    ).toMatchObject({ kind: "CONFIRMATION_REQUIRED", differenceKm: 10_195 });
    expect(
      decideOdometerSubmission({
        proposedKm: 184_000,
        thresholdKm: 1_000,
        latestAccepted: accepted,
        hasPendingReview: false,
      }),
    ).toMatchObject({ kind: "REGRESSION" });
    expect(
      decideOdometerSubmission({
        proposedKm: 185_000,
        thresholdKm: 1_000,
        latestAccepted: accepted,
        hasPendingReview: true,
      }),
    ).toMatchObject({ kind: "PENDING_REVIEW" });
  });

  it("derives service kilometres without storing another source of truth", () => {
    expect(kilometresRemaining(184_320, 190_000)).toBe(5_680);
    expect(kilometresRemaining(190_100, 190_000)).toBe(-100);
    expect(kilometresRemaining(null, 190_000)).toBeNull();
  });

  it("requires reason for out-of-service entry and administrative restoration", () => {
    expect(() =>
      validateManualVehicleStatusTransition("ACTIVE", "OUT_OF_SERVICE", undefined),
    ).toThrow(ValidationError);
    expect(() =>
      validateManualVehicleStatusTransition("OUT_OF_SERVICE", "ACTIVE", undefined),
    ).toThrow(ValidationError);
    expect(() =>
      validateManualVehicleStatusTransition("OUT_OF_SERVICE", "ACTIVE", "Administrative clearance"),
    ).not.toThrow();
  });
});

describe("odometer anomaly confirmation tokens", () => {
  const expected = {
    actorUserId: "user-a",
    companyId: "company-a",
    vehicleId: "vehicle-a",
    proposedKm: 194_515,
    acceptedReadingId: "reading-a",
    acceptedOdometerKm: 184_320,
    thresholdKm: 1_000,
  };

  it("binds confirmation to the exact server-calculated facts", () => {
    const service = new OdometerConfirmationTokenService(randomBytes(32), () => 1_000);
    const token = service.issue(expected);
    expect(service.verify(token, expected).vehicleId).toBe("vehicle-a");
    expect(() => service.verify(token, { ...expected, thresholdKm: 2_000 })).toThrow(
      ValidationError,
    );
  });

  it("rejects expired and tampered confirmation tokens", () => {
    const key = randomBytes(32);
    const issue = new OdometerConfirmationTokenService(key, () => 1_000);
    const token = issue.issue(expected);
    const expired = new OdometerConfirmationTokenService(key, () => 700_001);
    expect(() => expired.verify(token, expected)).toThrow(ValidationError);
    expect(() => issue.verify(`${token}x`, expected)).toThrow(ValidationError);
  });

  it("requires an independent 32-byte confirmation key", () => {
    expect(() => odometerConfirmationKeyFromEnvironment({})).toThrow(ValidationError);
    expect(() =>
      odometerConfirmationKeyFromEnvironment({ OIS_ODOMETER_CONFIRMATION_KEY: "abc" }),
    ).toThrow(ValidationError);
  });
});
