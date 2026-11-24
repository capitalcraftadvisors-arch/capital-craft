import { describe, expect, it } from "vitest";
import { EMPLOYMENT_LABEL, PLANT_USE_LABEL, SYSTEM_LABEL, loanDisplayId } from "../loan-labels";

describe("loan labels", () => {
  it("names each solar system type", () => {
    expect(SYSTEM_LABEL).toEqual({ on_grid: "On-Grid", off_grid: "Off-Grid", hybrid: "Hybrid" });
  });

  it("names each plant use", () => {
    expect(PLANT_USE_LABEL).toEqual({ residential: "Residential", commercial: "Commercial" });
  });

  it("names each employment type", () => {
    expect(EMPLOYMENT_LABEL).toEqual({ salaried: "Salaried", self_employed: "Self-employed" });
  });
});

describe("loanDisplayId", () => {
  const id = "3f2a9c1b-77de-4e0a-9b1c-0123456789ab";

  it("uses the stored id when there is one", () => {
    expect(loanDisplayId(id, "LA-45691-0007")).toBe("LA-45691-0007");
  });

  it("falls back to LA- + the first 8 characters of the uuid, upper case", () => {
    expect(loanDisplayId(id)).toBe("LA-3F2A9C1B");
    expect(loanDisplayId(id, null)).toBe("LA-3F2A9C1B");
    expect(loanDisplayId(id, "")).toBe("LA-3F2A9C1B");
  });

  it("skips the dashes when the uuid starts with a short group", () => {
    expect(loanDisplayId("ab-cd-ef01-2345")).toBe("LA-ABCDEF01");
  });
});
