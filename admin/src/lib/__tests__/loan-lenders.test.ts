import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOAN_LENDERS, type LoanLenderRow,
  approvedLenders, fetchLenders, latestLenderStatus, latestStatusLabel, lenderLabelIn,
  lenderStateOf, lendersWithDocs, slugifyLender,
} from "../loan-lenders";

// One loan_application_lenders row; only the fields a test cares about are passed.
function row(lender_key: string, lender_label: string, at: Partial<LoanLenderRow> = {}): LoanLenderRow {
  return {
    id: `row-${lender_key}`,
    application_id: "app-1",
    lender_key,
    lender_label,
    docs_sent_at: null,
    approved_at: null,
    rejected_at: null,
    rejection_reason: null,
    approval_details: null,
    approval_recorded_at: null,
    ...at,
  };
}

const D1 = "2026-07-01T10:00:00+00:00";
const D2 = "2026-07-02T10:00:00+00:00";
const D3 = "2026-07-03T10:00:00+00:00";
const D4 = "2026-07-04T10:00:00+00:00";

describe("slugifyLender", () => {
  it("turns a lender name into a lower_snake key", () => {
    expect(slugifyLender("Aerem")).toBe("aerem");
    expect(slugifyLender("  Credit Fair ")).toBe("credit_fair");
    expect(slugifyLender("L&T Finance")).toBe("l_t_finance");
    expect(slugifyLender("--Tata Capital--")).toBe("tata_capital");
    expect(slugifyLender("")).toBe("");
  });
});

describe("lenderLabelIn", () => {
  const list = [{ key: "aerem", label: "Aerem Solar Finance" }, { key: "tata", label: "Tata Capital" }];

  it("gives the name from the list", () => {
    expect(lenderLabelIn(list, "tata")).toBe("Tata Capital");
    expect(lenderLabelIn(list, "aerem")).toBe("Aerem Solar Finance");
  });

  it("falls back to the original three lenders, then to the key itself", () => {
    expect(lenderLabelIn(list, "creditfair")).toBe("Credit Fair");
    expect(lenderLabelIn([], "solfin")).toBe("Solfin");
    expect(lenderLabelIn(list, "new_lender")).toBe("new_lender");
  });

  it("is empty when there is no key", () => {
    expect(lenderLabelIn(list, null)).toBe("");
    expect(lenderLabelIn(list, undefined)).toBe("");
    expect(lenderLabelIn(list, "")).toBe("");
  });
});

describe("lenderStateOf", () => {
  it("reads a lender row's state: rejected, then approved, then docs sent", () => {
    expect(lenderStateOf(row("a", "A"))).toBe("none");
    expect(lenderStateOf(row("a", "A", { docs_sent_at: D1 }))).toBe("docs");
    expect(lenderStateOf(row("a", "A", { docs_sent_at: D1, approved_at: D2 }))).toBe("approved");
    expect(lenderStateOf(row("a", "A", { docs_sent_at: D1, rejected_at: D2 }))).toBe("rejected");
    expect(lenderStateOf(row("a", "A", { approved_at: D2, rejected_at: D3 }))).toBe("rejected");
  });
});

describe("latestLenderStatus", () => {
  it("is null with no lenders, or none that has been sent anything", () => {
    expect(latestLenderStatus([])).toBeNull();
    expect(latestLenderStatus([row("aerem", "Aerem")])).toBeNull();
  });

  it("shows docs sent while a lender is still deciding", () => {
    expect(latestLenderStatus([row("aerem", "Aerem", { docs_sent_at: D1 })]))
      .toEqual({ kind: "docs", lenderKey: "aerem", lenderLabel: "Aerem", at: D1 });
  });

  it("an approval wins over pending and rejected lenders, even older ones", () => {
    const s = latestLenderStatus([
      row("aerem", "Aerem", { docs_sent_at: D1, approved_at: D2 }),
      row("solfin", "Solfin", { docs_sent_at: D3 }),
      row("creditfair", "Credit Fair", { docs_sent_at: D1, rejected_at: D4 }),
    ]);
    expect(s).toEqual({ kind: "approved", lenderKey: "aerem", lenderLabel: "Aerem", at: D2 });
  });

  it("a lender still deciding wins over a newer rejection", () => {
    const s = latestLenderStatus([
      row("solfin", "Solfin", { docs_sent_at: D1 }),
      row("creditfair", "Credit Fair", { docs_sent_at: D1, rejected_at: D4 }),
    ]);
    expect(s?.kind).toBe("docs");
    expect(s?.lenderKey).toBe("solfin");
  });

  it("shows a rejection when every lender has rejected — even one back-dated before its docs date", () => {
    const s = latestLenderStatus([row("aerem", "Aerem", { docs_sent_at: D3, rejected_at: D2 })]);
    expect(s).toEqual({ kind: "rejected", lenderKey: "aerem", lenderLabel: "Aerem", at: D2 });
  });

  it("picks the newest within the same kind", () => {
    const approved = latestLenderStatus([
      row("aerem", "Aerem", { approved_at: D2 }),
      row("solfin", "Solfin", { approved_at: D4 }),
      row("creditfair", "Credit Fair", { approved_at: D3 }),
    ]);
    expect(approved?.lenderKey).toBe("solfin");

    const pending = latestLenderStatus([
      row("aerem", "Aerem", { docs_sent_at: D3 }),
      row("solfin", "Solfin", { docs_sent_at: D1 }),
    ]);
    expect(pending?.lenderKey).toBe("aerem");

    const rejected = latestLenderStatus([
      row("aerem", "Aerem", { rejected_at: D1 }),
      row("solfin", "Solfin", { rejected_at: D2 }),
    ]);
    expect(rejected?.lenderKey).toBe("solfin");
  });
});

describe("latestStatusLabel", () => {
  it("names the event and the lender", () => {
    expect(latestStatusLabel({ kind: "docs", lenderKey: "aerem", lenderLabel: "Aerem", at: D1 })).toBe("Doc sent to Aerem");
    expect(latestStatusLabel({ kind: "approved", lenderKey: "creditfair", lenderLabel: "Credit Fair", at: D1 })).toBe("Approved by Credit Fair");
    expect(latestStatusLabel({ kind: "rejected", lenderKey: "solfin", lenderLabel: "Solfin", at: D1 })).toBe("Rejected by Solfin");
  });

  it("is null with no status", () => {
    expect(latestStatusLabel(null)).toBeNull();
  });
});

describe("lendersWithDocs / approvedLenders", () => {
  const rows = [
    row("aerem", "Aerem", { docs_sent_at: D1, approved_at: D2 }),
    row("solfin", "Solfin", { docs_sent_at: D1 }),
    row("creditfair", "Credit Fair"),
  ];

  it("lendersWithDocs keeps the lenders that were sent documents", () => {
    expect(lendersWithDocs(rows).map((r) => r.lender_key)).toEqual(["aerem", "solfin"]);
  });

  it("approvedLenders keeps the lenders that approved", () => {
    expect(approvedLenders(rows).map((r) => r.lender_key)).toEqual(["aerem"]);
  });
});

describe("fetchLenders", () => {
  // A stand-in for the Supabase client: records the query and answers `reply`.
  function fakeClient(reply: { data: unknown; error: unknown }) {
    const calls: string[] = [];
    const query = {
      select: (cols: string) => { calls.push(`select ${cols}`); return query; },
      eq: (col: string, v: unknown) => { calls.push(`eq ${col}=${v}`); return query; },
      order: (col: string) => { calls.push(`order ${col}`); return query; },
      then: (resolve: (r: typeof reply) => void) => resolve(reply),
    };
    return { calls, client: { from: (t: string) => { calls.push(`from ${t}`); return query; } } };
  }

  it("reads the active lenders in their set order", async () => {
    const list = [{ key: "tata", label: "Tata Capital" }];
    const { calls, client } = fakeClient({ data: list, error: null });
    expect(await fetchLenders(client)).toEqual(list);
    expect(calls).toEqual(["from lenders", "select key, label", "eq is_active=true", "order sort_order", "order label"]);
  });

  it("falls back to the original three on an error or an empty list", async () => {
    expect(await fetchLenders(fakeClient({ data: null, error: { message: "denied" } }).client)).toEqual(DEFAULT_LOAN_LENDERS);
    expect(await fetchLenders(fakeClient({ data: [], error: null }).client)).toEqual(DEFAULT_LOAN_LENDERS);
  });

  it("the original three are Aerem, Credit Fair and Solfin", () => {
    expect(DEFAULT_LOAN_LENDERS.map((l) => l.key)).toEqual(["aerem", "creditfair", "solfin"]);
  });
});
