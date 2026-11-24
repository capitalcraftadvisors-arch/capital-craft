import { describe, expect, it, vi } from "vitest";

vi.mock("../gcs", () => ({ downloadBuffer: vi.fn() })); // no Cloud Storage in a unit test

import { buildQuotationData, type QuotationInput } from "../quotation";

const input = (over: Partial<QuotationInput>): QuotationInput => ({
  customer_name: "Test", city: "Jaipur", state: "Rajasthan", quote_no: "Q-1", date: "24/11/2026",
  kw: 3, system_type: "On-grid", total: 200000, subsidised: true,
  make_panel: "", make_inverter: "", make_structure: "", ...over,
});

describe("buildQuotationData — subsidies", () => {
  it("central by the 1 / 2 / 3 kW tiers, state a fixed ₹17,000", () => {
    for (const [kw, central] of [[1, 30000], [2, 60000], [3, 78000], [6, 78000]] as const) {
      const d = buildQuotationData(input({ kw }));
      expect(d._state_subsidy).toBe(17000);
      expect(d._final).toBe(200000 - central - 17000);
    }
  });

  it("takes whole kW only (a decimal size is rounded)", () => {
    expect(buildQuotationData(input({ kw: "2.8" })).kw).toBe("3");
    expect(buildQuotationData(input({ kw: "2.8" }))._final).toBe(200000 - 78000 - 17000);
  });

  it("gives no subsidy on a plan without one", () => {
    const d = buildQuotationData(input({ subsidised: false }));
    expect(d._state_subsidy).toBe(0);
    expect(d._final).toBe(200000);
    expect(d.central_subsidy).toBe("Not availed");
  });
});
