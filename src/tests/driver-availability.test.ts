import { describe, expect, it } from "vitest";
import { driverAvailabilitySchema } from "@/modules/drivers/driver.schemas";

const week = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  isAvailable: dayOfWeek < 5,
}));

describe("canonical driver availability", () => {
  it("requires every weekday exactly once", () => {
    expect(driverAvailabilitySchema.parse(week)).toHaveLength(7);
    expect(() => driverAvailabilitySchema.parse(week.slice(0, 6))).toThrow();
    expect(() =>
      driverAvailabilitySchema.parse([...week.slice(0, 6), { dayOfWeek: 5, isAvailable: false }]),
    ).toThrow();
  });
});
