import { describe, expect, it } from "vitest";
import { defaultVehicleCategories, normalizeRegistration } from "@/modules/vehicles/registration";

describe("vehicle registration normalization", () => {
  it("normalizes approved separators while retaining an upper-case display value", () => {
    expect(normalizeRegistration(" ab- 12 cd ")).toEqual({
      display: "AB- 12 CD",
      normalized: "AB12CD",
    });
  });

  it("rejects unsupported characters", () => {
    expect(() => normalizeRegistration("AB/12")).toThrow("unsupported characters");
  });

  it("uses only the approved default vehicle categories", () => {
    expect(defaultVehicleCategories).toEqual(["VAN", "LR", "MR", "HR", "HC", "MC"]);
  });
});
