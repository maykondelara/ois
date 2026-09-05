export type AcceptedOdometer = Readonly<{ id: string; readingKm: number }>;

export type OdometerDecision =
  | Readonly<{ kind: "ACCEPT"; previous: AcceptedOdometer; differenceKm: number }>
  | Readonly<{ kind: "CONFIRMATION_REQUIRED"; previous: AcceptedOdometer; differenceKm: number }>
  | Readonly<{ kind: "NO_BASELINE" }>
  | Readonly<{ kind: "REGRESSION"; previous: AcceptedOdometer }>
  | Readonly<{ kind: "PENDING_REVIEW" }>;

export function decideOdometerSubmission(input: {
  proposedKm: number;
  thresholdKm: number;
  latestAccepted: AcceptedOdometer | null;
  hasPendingReview: boolean;
}): OdometerDecision {
  if (input.hasPendingReview) return { kind: "PENDING_REVIEW" };
  if (!input.latestAccepted) return { kind: "NO_BASELINE" };
  if (input.proposedKm < input.latestAccepted.readingKm)
    return { kind: "REGRESSION", previous: input.latestAccepted };
  const differenceKm = input.proposedKm - input.latestAccepted.readingKm;
  return differenceKm <= input.thresholdKm
    ? { kind: "ACCEPT", previous: input.latestAccepted, differenceKm }
    : { kind: "CONFIRMATION_REQUIRED", previous: input.latestAccepted, differenceKm };
}

export function kilometresRemaining(
  authoritativeOdometerKm: number | null,
  nextServiceOdometerKm: number | null,
): number | null {
  if (authoritativeOdometerKm === null || nextServiceOdometerKm === null) return null;
  return nextServiceOdometerKm - authoritativeOdometerKm;
}
