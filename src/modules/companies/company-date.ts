import { ValidationError } from "@/lib/errors";
/** Derives business DATE from the configured IANA timezone, never a browser offset. */
export function companyLocalDate(now: Date, timezone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const value = (kind: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === kind)?.value;
    return new Date(`${value("year")}-${value("month")}-${value("day")}T00:00:00.000Z`);
  } catch {
    throw new ValidationError("INVALID_COMPANY_TIMEZONE", "Company timezone is invalid");
  }
}
