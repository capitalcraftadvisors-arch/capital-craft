import { describe, expect, it } from "vitest";
import { routeForBusiness, type Business } from "../auth";

const epc = (over: Partial<Business>): Business =>
  ({ id: "b1", status: "draft", business_type: "proprietorship", current_step: 1, contact_name: null, ...over }) as Business;

describe("routeForBusiness", () => {
  it("sends a draft EPC to the step it is on", () => {
    expect(routeForBusiness(epc({ current_step: 1 }))).toBe("/onboarding/step-1");
    expect(routeForBusiness(epc({ current_step: 4 }))).toBe("/onboarding/step-4");
    expect(routeForBusiness(epc({ current_step: 6 }))).toBe("/onboarding/step-6");
  });

  it("sends a draft that finished step 6 (current_step 7) to Review — there is no step-7 page", () => {
    expect(routeForBusiness(epc({ current_step: 7 }))).toBe("/onboarding/review");
    expect(routeForBusiness(epc({ current_step: 9 }))).toBe("/onboarding/review");
  });

  it("starts a draft with no step at step 1", () => {
    expect(routeForBusiness(epc({ current_step: 0 }))).toBe("/onboarding/step-1");
    expect(routeForBusiness(epc({ current_step: null as unknown as number }))).toBe("/onboarding/step-1");
  });

  it("sends the Capital Craft team to its console", () => {
    expect(routeForBusiness(epc({ business_type: "admin", status: "approved" }))).toBe("/admin");
  });

  it("sends a submitted EPC without portal access to Status", () => {
    expect(routeForBusiness(epc({ status: "under_review", current_step: 7 }))).toBe("/status");
  });
});
