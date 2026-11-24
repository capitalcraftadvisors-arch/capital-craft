import { describe, expect, it, vi } from "vitest";

// file-links signs with the server secret, read when the module loads.
vi.hoisted(() => { process.env.APP_JWT_SECRET = "test-secret"; });

import { tranche2Of } from "../tranche2";
import { COMPLETION_CATEGORIES, TRANCHE2_KEYS, completionLabel, tranche2Lock } from "../disbursement";
import { fileLinkUrl, readFileLinkToken } from "../file-links";

const tokenOf = (url: string) => url.split("/api/f/")[1];

describe("tranche2Of (2nd tranche received)", () => {
  const row = { id: "a1", approved_lender: "creditfair", tranche2_docs: 5, second_disbursement_amount: null };

  it("is the EPC's latest upload or Send — a new Send brings a read case back", () => {
    const t = tranche2Of({ ...row, tranche2_epc_at: "2026-11-20T10:00:00Z", tranche2_submitted_at: "2026-11-24T09:00:00Z" }, "Ram", "Sarvatra");
    expect(t).toEqual({ id: "a1", name: "Ram", epc: "Sarvatra", lender: "creditfair", at: "2026-11-24T09:00:00Z", docs: 5 });
    expect(tranche2Of({ ...row, tranche2_epc_at: "2026-11-20T10:00:00Z" }, "Ram", null)?.at).toBe("2026-11-20T10:00:00Z");
  });

  it("is nothing before any upload, or once the 2nd disbursement is in", () => {
    expect(tranche2Of(row, "Ram", null)).toBeNull();
    expect(tranche2Of({ ...row, tranche2_epc_at: "2026-11-20T10:00:00Z", second_disbursement_amount: 47000 }, "Ram", null)).toBeNull();
  });
});

describe("the 2nd-tranche documents", () => {
  it("are the 5 required + the additional ones, each with its name", () => {
    expect(COMPLETION_CATEGORIES).toHaveLength(5);
    expect(TRANCHE2_KEYS).toEqual([...COMPLETION_CATEGORIES, "completion_other"]);
    expect(completionLabel("completion_invoice")).toBe("Final invoice");
    expect(completionLabel("completion_other")).toBe("Additional documents");
    expect(completionLabel("aadhaar")).toBeNull();
  });

  it("lock once the EPC sends; Message to EPC reopens some", () => {
    expect(tranche2Lock({})).toEqual({ locked: false, reopened: [] });
    expect(tranche2Lock({ tranche2_submitted_at: "2026-11-24T09:00:00Z", tranche2_allow: [] })).toEqual({ locked: true, reopened: [] });
    expect(tranche2Lock({ tranche2_submitted_at: "2026-11-24T09:00:00Z", tranche2_allow: ["completion_invoice"] }).reopened).toEqual(["completion_invoice"]);
  });
});

describe("file links (lender email)", () => {
  it("open the file, and a Download link carries the name to save it as", () => {
    const view = readFileLinkToken(tokenOf(fileLinkUrl("https://x.test", "applications/a1/completion_invoice/f.pdf")));
    expect(view).toEqual({ path: "applications/a1/completion_invoice/f.pdf" });
    const dl = readFileLinkToken(tokenOf(fileLinkUrl("https://x.test", "applications/a1/completion_invoice/f.pdf", { download: "Final invoice - Ram.pdf" })));
    expect(dl).toEqual({ path: "applications/a1/completion_invoice/f.pdf", download: "Final invoice - Ram.pdf" });
  });

  it("refuse a changed link", () => {
    const [payload, sig] = tokenOf(fileLinkUrl("https://x.test", "a.pdf", { download: "a.pdf" })).split(".");
    const forged = Buffer.from(JSON.stringify({ p: "b.pdf", e: 9999999999, d: "b.pdf" })).toString("base64url");
    expect(readFileLinkToken(`${forged}.${sig}`)).toEqual({ error: "invalid" });
    expect(readFileLinkToken(`${payload}.${sig}`)).toHaveProperty("path", "a.pdf");
  });
});
