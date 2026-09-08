import { describe, expect, it } from "vitest";
import {
  defaultVehicleCategories,
  defaultVehicleCategoryRequiredLicenceClass,
  normalizeRegistration,
} from "@/modules/vehicles/registration";

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

  it("maps only the approved built-in categories to known licence classes", () => {
    expect(defaultVehicleCategoryRequiredLicenceClass).toEqual({
      VAN: "C",
      LR: "LR",
      MR: "MR",
      HR: "HR",
      HC: "HC",
      MC: "MC",
    });
  });
});
