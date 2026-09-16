import type {
  CompanyOperationalSettings,
  Driver,
  DriverRegularAvailability,
  DriverVehicleCapability,
  Vehicle,
  VehicleCategory,
  VehicleOdometerReading,
  VehicleStatusHistory,
} from "@prisma/client";
import type { SafeDriverLicence } from "@/modules/drivers/driver-licence.service";
import type {
  OdometerSubmissionResult as DomainOdometerSubmissionResult,
  VehicleOperationalSnapshot,
} from "@/modules/vehicles/odometer.service";

const iso = (value: Date | null) => value?.toISOString() ?? null;

export type DriverSummary = Readonly<{
  id: string;
  displayName: string;
  phoneE164: string | null;
  operationalStatus: Driver["operationalStatus"];
  depotLocationId: string | null;
  linkedUser: boolean;
  emergencyContactName: string | null;
  emergencyContactPhoneE164: string | null;
}>;
export type DriverDetail = DriverSummary;
export type DriverAvailability = Readonly<{ dayOfWeek: number; isAvailable: boolean }>;
export type DriverLicenceSummary = Readonly<{
  id: string;
  driverId: string;
  licenceType: string;
  issuingJurisdiction: string | null;
  licenceNumberLast4: string;
  issuedOn: string | null;
  expiresOn: string;
}>;
export type VehicleCategorySummary = Readonly<{
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  requiredLicenceClass: VehicleCategory["requiredLicenceClass"];
}>;
export type VehicleSummary = Readonly<{
  id: string;
  registrationDisplay: string;
  registrationNormalized: string;
  operationalStatus: Vehicle["operationalStatus"];
  vehicleCategoryId: string;
  depotLocationId: string | null;
  registrationExpiresOn: string | null;
  nextServiceOdometerKm: number | null;
}>;
export type OdometerSnapshot = Readonly<{
  vehicleId: string;
  authoritativeOdometerKm: number | null;
  nextServiceOdometerKm: number | null;
  kilometresRemaining: number | null;
  latestAcceptedReading: Readonly<{
    id: string;
    readingKm: number;
    source: string;
    acceptedAt: string | null;
  }> | null;
}>;
export type VehicleDetail = VehicleSummary &
  Readonly<{
    authoritativeOdometerKm: number | null;
    kilometresRemaining: number | null;
    latestAcceptedReading: OdometerSnapshot["latestAcceptedReading"];
  }>;
export type VehicleStatusHistorySummary = Readonly<{
  id: string;
  fromStatus: VehicleStatusHistory["fromStatus"];
  toStatus: VehicleStatusHistory["toStatus"];
  reason: string | null;
  source: VehicleStatusHistory["source"];
  occurredAt: string;
}>;
export type OdometerReviewResult = Readonly<{
  id: string;
  readingKm: number;
  status: VehicleOdometerReading["status"];
  source: VehicleOdometerReading["source"];
  reviewNote: string | null;
  reviewedAt: string | null;
  acceptedAt: string | null;
}>;
export type OdometerSubmissionResult =
  | Readonly<{ kind: "ACCEPTED"; readingId: string; readingKm: number }>
  | Readonly<{ kind: "REVIEW_REQUIRED"; readingId: string; readingKm: number }>
  | Readonly<{
      kind: "ANOMALY_CONFIRMATION_REQUIRED";
      confirmationToken: string;
      previousReadingId: string;
      previousOdometerKm: number;
      thresholdKm: number;
      differenceKm: number;
    }>;
export type OperationalSettings = Readonly<{
  odometerExpectedIncreaseThresholdKm: number;
  inspectionVehicleSelectionStrategy: string;
}>;

export const driverDto = (driver: Driver): DriverSummary => ({
  id: driver.id,
  displayName: driver.displayName,
  phoneE164: driver.phoneE164,
  operationalStatus: driver.operationalStatus,
  depotLocationId: driver.depotLocationId,
  linkedUser: driver.userId !== null,
  emergencyContactName: driver.emergencyContactName,
  emergencyContactPhoneE164: driver.emergencyContactPhoneE164,
});
export const availabilityDto = (entry: DriverRegularAvailability): DriverAvailability => ({
  dayOfWeek: entry.dayOfWeek,
  isAvailable: entry.isAvailable,
});
export const licenceDto = (licence: SafeDriverLicence): DriverLicenceSummary => ({
  id: licence.id,
  driverId: licence.driverId,
  licenceType: licence.licenceType,
  issuingJurisdiction: licence.issuingJurisdiction,
  licenceNumberLast4: licence.licenceNumberLast4,
  issuedOn: iso(licence.issuedOn),
  expiresOn: licence.expiresOn.toISOString(),
});
export const categoryDto = (category: VehicleCategory): VehicleCategorySummary => ({
  id: category.id,
  code: category.code,
  name: category.name,
  isActive: category.isActive,
  requiredLicenceClass: category.requiredLicenceClass,
});
export const capabilityDto = (capability: DriverVehicleCapability) => ({
  id: capability.id,
  vehicleCategoryId: capability.vehicleCategoryId,
  isActive: capability.isActive,
  expiresOn: iso(capability.expiresOn),
});
export const vehicleDto = (vehicle: Vehicle): VehicleSummary => ({
  id: vehicle.id,
  registrationDisplay: vehicle.registrationDisplay,
  registrationNormalized: vehicle.registrationNormalized,
  operationalStatus: vehicle.operationalStatus,
  vehicleCategoryId: vehicle.vehicleCategoryId,
  depotLocationId: vehicle.depotLocationId,
  registrationExpiresOn: iso(vehicle.registrationExpiresOn),
  nextServiceOdometerKm: vehicle.nextServiceOdometerKm,
});
export const vehicleStatusHistoryDto = (
  entry: VehicleStatusHistory,
): VehicleStatusHistorySummary => ({
  id: entry.id,
  fromStatus: entry.fromStatus,
  toStatus: entry.toStatus,
  reason: entry.reason,
  source: entry.source,
  occurredAt: entry.occurredAt.toISOString(),
});
/** Detail-only derived fields are calculated from immutable odometer provenance. */
export const vehicleDetailDto = (
  vehicle: Vehicle,
  snapshot: VehicleOperationalSnapshot,
): VehicleDetail => ({
  ...vehicleDto(vehicle),
  authoritativeOdometerKm: snapshot.authoritativeOdometerKm,
  kilometresRemaining: snapshot.kilometresRemaining,
  latestAcceptedReading: snapshot.latestAcceptedReading
    ? {
        id: snapshot.latestAcceptedReading.id,
        readingKm: snapshot.latestAcceptedReading.readingKm,
        source: snapshot.latestAcceptedReading.source,
        acceptedAt: iso(snapshot.latestAcceptedReading.acceptedAt),
      }
    : null,
});
export const snapshotDto = (snapshot: VehicleOperationalSnapshot): OdometerSnapshot => ({
  vehicleId: snapshot.vehicleId,
  authoritativeOdometerKm: snapshot.authoritativeOdometerKm,
  nextServiceOdometerKm: snapshot.nextServiceOdometerKm,
  kilometresRemaining: snapshot.kilometresRemaining,
  latestAcceptedReading: snapshot.latestAcceptedReading
    ? {
        ...snapshot.latestAcceptedReading,
        acceptedAt: iso(snapshot.latestAcceptedReading.acceptedAt),
      }
    : null,
});
export const odometerReadingDto = (reading: VehicleOdometerReading): OdometerReviewResult => ({
  id: reading.id,
  readingKm: reading.readingKm,
  status: reading.status,
  source: reading.source,
  reviewNote: reading.reviewNote,
  reviewedAt: iso(reading.reviewedAt),
  acceptedAt: iso(reading.acceptedAt),
});
export const odometerSubmissionDto = (
  result: DomainOdometerSubmissionResult,
): OdometerSubmissionResult => {
  if (result.kind === "ACCEPTED" || result.kind === "REVIEW_REQUIRED") return result;
  // The confirmation token remains opaque: this mapper intentionally does not decode or log it.
  return {
    kind: result.kind,
    confirmationToken: result.confirmationToken,
    previousReadingId: result.previousReadingId,
    previousOdometerKm: result.previousOdometerKm,
    thresholdKm: result.thresholdKm,
    differenceKm: result.differenceKm,
  };
};

export const settingsDto = (
  settings:
    | CompanyOperationalSettings
    | {
        companyId: string;
        odometerExpectedIncreaseThresholdKm: number;
        inspectionVehicleSelectionStrategy: string;
      },
): OperationalSettings => ({
  odometerExpectedIncreaseThresholdKm: settings.odometerExpectedIncreaseThresholdKm,
  inspectionVehicleSelectionStrategy: settings.inspectionVehicleSelectionStrategy,
});
