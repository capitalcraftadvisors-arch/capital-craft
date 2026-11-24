import { describe, expect, it } from "vitest";
import {
  CENTRAL_SUBSIDY_CAP, DEFAULT_INDICATIVE_ROI, TENURES,
  STATE_SUBSIDY, centralSubsidyFor, computeCentralSubsidy, computeEmi, computeFlatEmi, stateSubsidyFor,
} from "../emi";

describe("computeEmi (reducing balance)", () => {
  it("matches the standard EMI tables, rounded to the rupee", () => {
    expect(computeEmi(100000, 12, 1)).toBe(8885);   // 8,884.88
    expect(computeEmi(500000, 10, 5)).toBe(10624);  // 10,623.52
  });

  it("works at the portal's indicative rate", () => {
    expect(DEFAULT_INDICATIVE_ROI).toBe(16);
    expect(computeEmi(100000, DEFAULT_INDICATIVE_ROI, 1)).toBe(9073);
    expect(computeEmi(200000, DEFAULT_INDICATIVE_ROI, 5)).toBe(4864);
  });

  it("is more than the interest-free share and falls as the tenure grows", () => {
    const emis = TENURES.map((y) => computeEmi(300000, 16, y));
    TENURES.forEach((y, i) => expect(emis[i]).toBeGreaterThan(300000 / (y * 12)));
    for (let i = 1; i < emis.length; i++) expect(emis[i]).toBeLessThan(emis[i - 1]);
  });

  it("is 0 when the principal, rate or tenure is 0 or negative", () => {
    expect(computeEmi(0, 16, 5)).toBe(0);
    expect(computeEmi(-100000, 16, 5)).toBe(0);
    expect(computeEmi(100000, 0, 5)).toBe(0);
    expect(computeEmi(100000, 16, 0)).toBe(0);
  });
});

describe("computeFlatEmi", () => {
  it("charges interest on the full principal for the whole tenure", () => {
    expect(computeFlatEmi(100000, 10, 2)).toBe(5000);   // 1,20,000 / 24
    expect(computeFlatEmi(120000, 12, 1)).toBe(11200);  // 1,34,400 / 12
  });

  it("is the plain split at 0% and rounds to the rupee", () => {
    expect(computeFlatEmi(100000, 0, 1)).toBe(8333);
  });

  it("is 0 when the principal or tenure is 0 or negative", () => {
    expect(computeFlatEmi(0, 10, 2)).toBe(0);
    expect(computeFlatEmi(100000, 10, 0)).toBe(0);
    expect(computeFlatEmi(-1, 10, 2)).toBe(0);
  });
});

describe("TENURES", () => {
  it("is 1 to 5 years", () => {
    expect([...TENURES]).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("computeCentralSubsidy (PM Surya Ghar)", () => {
  it("pays by whole kW: 1 kW ₹30,000, 2 kW ₹60,000, 3 kW and up ₹78,000", () => {
    expect(computeCentralSubsidy(1)).toBe(30000);
    expect(computeCentralSubsidy(1.9)).toBe(30000);
    expect(computeCentralSubsidy(2)).toBe(60000);
    expect(computeCentralSubsidy(2.9)).toBe(60000);
    expect(computeCentralSubsidy(3)).toBe(78000);
    expect(computeCentralSubsidy(10)).toBe(CENTRAL_SUBSIDY_CAP);
  });

  it("is 0 below 1 kW, and for a missing or non-number size", () => {
    expect(computeCentralSubsidy(0.5)).toBe(0);
    expect(computeCentralSubsidy(0)).toBe(0);
    expect(computeCentralSubsidy(-3)).toBe(0);
    expect(computeCentralSubsidy(null)).toBe(0);
    expect(computeCentralSubsidy(NaN)).toBe(0);
  });
});

describe("centralSubsidyFor", () => {
  it("is the PM Surya Ghar subsidy for a home and 0 for a commercial plant", () => {
    expect(centralSubsidyFor(3, false)).toBe(78000);
    expect(centralSubsidyFor(2, false)).toBe(60000);
    expect(centralSubsidyFor(3, true)).toBe(0);
    expect(centralSubsidyFor(null, false)).toBe(0);
  });
});

describe("stateSubsidyFor (quotation builder)", () => {
  it("is a fixed ₹17,000 for any size", () => {
    for (const kw of [1, 2, 3, 5, 10]) expect(stateSubsidyFor(kw)).toBe(STATE_SUBSIDY);
    expect(STATE_SUBSIDY).toBe(17000);
  });

  it("is 0 for a missing, zero, negative or non-number size", () => {
    expect(stateSubsidyFor(0)).toBe(0);
    expect(stateSubsidyFor(-2)).toBe(0);
    expect(stateSubsidyFor(NaN)).toBe(0);
  });
});
