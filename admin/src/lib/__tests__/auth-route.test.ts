import { afterEach, describe, expect, it, vi } from "vitest";
import { GREET_KEY, afterLoginRoute, loginHref, pageOpened, routeForBusiness, safeNext, type Business } from "../auth";

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

describe("safeNext — only a page inside this app", () => {
  it("keeps an in-app path with its query", () => {
    expect(safeNext("/dashboard/leads?f=due")).toBe("/dashboard/leads?f=due");
    expect(safeNext("/admin/app/3f2b8c1e-1a2b-4c3d-9e8f-0a1b2c3d4e5f/view?tab=docs")).toBe("/admin/app/3f2b8c1e-1a2b-4c3d-9e8f-0a1b2c3d4e5f/view?tab=docs");
  });

  it("refuses another site, however it is written", () => {
    for (const bad of [
      "https://evil.example", "//evil.example", String.raw`/\evil.example`, String.raw`\\evil.example`,
      "/\t/evil.example", "/\n/evil.example", "javascript:alert(1)", "evil.example/x", " /dashboard",
      // "." / ".." segments that clean up to a leading "//"
      "/.//evil.example", "/..//evil.example", "/%2e//evil.example", "/%2e%2e//evil.example", "/a/..//evil.example",
      "/x/.././/evil.example/p", "/\t.//evil.example",
    ]) expect(safeNext(bad)).toBeNull();
  });

  it("refuses the root, /login, API routes, empty and very long values", () => {
    for (const bad of ["/", "/login", "/login?next=/x", "/api/admin/delete-epc", "/a/../login", "/a/../api/x", "", null, undefined, "/" + "a".repeat(1000)])
      expect(safeNext(bad as string | null | undefined)).toBeNull();
  });
});

describe("loginHref", () => {
  it("adds the page to come back to", () => {
    expect(loginHref("/dashboard/leads?f=due")).toBe("/login?next=%2Fdashboard%2Fleads%3Ff%3Ddue");
  });
  it("is plain /login when there is nothing safe to come back to", () => {
    expect(loginHref(null)).toBe("/login");
    expect(loginHref("/")).toBe("/login");
    expect(loginHref("//evil.example")).toBe("/login");
  });
});

describe("afterLoginRoute", () => {
  const approved = epc({ status: "approved", loan_app_unlocked: true, service_type: "loans", current_step: 7 });
  it("lands on the page the login was asked for", () => {
    expect(afterLoginRoute(approved, "?next=%2Fdashboard%2Fleads%3Ff%3Ddue")).toBe("/dashboard/leads?f=due");
  });
  it("lands on the account's home without a safe next", () => {
    expect(afterLoginRoute(approved, "")).toBe("/dashboard");
    expect(afterLoginRoute(approved, "?next=https%3A%2F%2Fevil.example")).toBe("/dashboard");
    expect(afterLoginRoute(epc({ current_step: 3 }), "?next=%2F%2Fevil.example")).toBe("/onboarding/step-3");
    expect(afterLoginRoute(approved, "?next=%2F.%2F%2Fevil.example")).toBe("/dashboard");
  });
  it("works the same for the Capital Craft team and the owner", () => {
    const team = epc({ business_type: "admin", status: "approved" });
    const owner = epc({ business_type: "admin", status: "approved", is_owner: true });
    expect(afterLoginRoute(team, "?next=%2Fadmin%2Fpendings")).toBe("/admin/pendings");
    expect(afterLoginRoute(owner, "")).toBe("/admin/pri");
  });
  it("follows next only for the account the tab was last open as (none yet = a new tab, e.g. an email link)", () => {
    const next = "?next=%2Fdashboard%2Fleads";
    expect(afterLoginRoute(approved, next, null)).toBe("/dashboard/leads");
    expect(afterLoginRoute(approved, next, "b1:")).toBe("/dashboard/leads");
    expect(afterLoginRoute(approved, next, "b2:")).toBe("/dashboard");
    expect(afterLoginRoute(approved, next, "b1:m1")).toBe("/dashboard"); // a staff login of the same company is someone else
  });
});

describe("pageOpened", () => {
  const store = new Map<string, string>();
  const stubStorage = () => vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  afterEach(() => { store.clear(); vi.unstubAllGlobals(); });
  const approved = epc({ status: "approved", loan_app_unlocked: true, service_type: "loans", current_step: 7 });

  it("keeps the login welcome on the home page and drops it on any other page", () => {
    stubStorage();
    store.set(GREET_KEY, "1");
    pageOpened(approved, "/dashboard");
    expect(store.get(GREET_KEY)).toBe("1");
    pageOpened(approved, "/dashboard/leads");
    expect(store.has(GREET_KEY)).toBe(false);
  });

  it("remembers the tab's account, so another account signing in on that tab goes home", () => {
    stubStorage();
    pageOpened(approved, "/dashboard/leads");
    expect(afterLoginRoute(approved, "?next=%2Fdashboard%2Fleads")).toBe("/dashboard/leads");
    expect(afterLoginRoute(epc({ ...approved, id: "b2" }), "?next=%2Fdashboard%2Fleads")).toBe("/dashboard");
  });
});
