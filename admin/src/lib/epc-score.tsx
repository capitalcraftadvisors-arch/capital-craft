"use client";

// Capital Craft EPC Score — computed AUTOMATICALLY from the EPC's loan history
// (no manual entry). Six measurable criteria, each 1–5 stars, averaged to /100.
// Shown in the EPC profile header.
//
// Thresholds (tune here in one place):
//  - Approval ratio       approved ÷ total          ≥80%→5 ≥60%→4 ≥40%→3 ≥20%→2 else 1
//  - Cancellation ratio   (rejected+aborted) ÷ total  ≤10%→5 ≤20%→4 ≤35%→3 ≤50%→2 else 1  (lower is better)
//  - Second-tranche       2nd-disbursed ÷ 1st-disbursed ≥80%→5 ≥60%→4 ≥40%→3 ≥20%→2 else 1
//  - Transaction volume   total loans               ≥20→5 ≥10→4 ≥5→3 ≥2→2 ≥1→1
//  - Repeat business      borrowers with >1 loan     ≥3→5  =2→4  =1→3  (else ≥3 loans→2)  else 1
//  - Installation TAT     # of 1st-disbursement customers (user's rule):
//                         ≥10→5  7–9→4  5–6→3  3–4→2  1–2→1  0→0

export type EpcLoan = {
  status?: string | null;
  first_disbursement_amount?: number | null;
  second_disbursement_amount?: number | null;
  created_at?: string | null;
  borrower_pan?: string | null;
  borrower_mobile?: string | null;
};

const APPROVED = new Set(["approved", "rfd", "sent_to_nbfc", "disbursed"]);
const CANCELLED = new Set(["rejected", "aborted"]);

export type EpcScore = { total: number; stars: number; criteria: { key: string; label: string; stars: number; detail: string }[] };

export function computeEpcScore(all: EpcLoan[]): EpcScore | null {
  // Only real submissions count — drafts aren't a transaction.
  const loans = all.filter((l) => l.status !== "draft");
  const total = loans.length;
  if (total === 0) return null; // nothing to score yet

  const firstDisb = loans.filter((l) => l.first_disbursement_amount != null).length;
  const secondDisb = loans.filter((l) => l.second_disbursement_amount != null).length;
  const approved = loans.filter((l) => l.first_disbursement_amount != null || (l.status ? APPROVED.has(l.status) : false)).length;
  const cancelled = loans.filter((l) => (l.status ? CANCELLED.has(l.status) : false)).length;

  const appR = approved / total;
  const s1 = appR >= 0.8 ? 5 : appR >= 0.6 ? 4 : appR >= 0.4 ? 3 : appR >= 0.2 ? 2 : 1;

  const canR = cancelled / total;
  const s2 = canR <= 0.1 ? 5 : canR <= 0.2 ? 4 : canR <= 0.35 ? 3 : canR <= 0.5 ? 2 : 1;

  const trR = firstDisb === 0 ? 0 : secondDisb / firstDisb;
  const s3 = firstDisb === 0 ? 1 : trR >= 0.8 ? 5 : trR >= 0.6 ? 4 : trR >= 0.4 ? 3 : trR >= 0.2 ? 2 : 1;

  const s4 = total >= 20 ? 5 : total >= 10 ? 4 : total >= 5 ? 3 : total >= 2 ? 2 : 1;

  const counts = new Map<string, number>();
  for (const l of loans) {
    const k = (l.borrower_pan || "").toUpperCase() || (l.borrower_mobile || "");
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  }
  const repeat = [...counts.values()].filter((c) => c > 1).length;
  const s5 = repeat >= 3 ? 5 : repeat === 2 ? 4 : repeat === 1 ? 3 : total >= 3 ? 2 : 1;

  // Installation TAT — throughput proxy: number of customers whose 1st tranche is out.
  const n = firstDisb;
  const s6 = n >= 10 ? 5 : n >= 7 ? 4 : n >= 5 ? 3 : n >= 3 ? 2 : n >= 1 ? 1 : 0;

  const criteria = [
    { key: "approval_ratio", label: "Approval ratio", stars: s1, detail: `${approved}/${total} approved` },
    { key: "cancellation_ratio", label: "Cancellation ratio", stars: s2, detail: `${cancelled}/${total} cancelled` },
    { key: "second_tranche", label: "Second-tranche completion", stars: s3, detail: firstDisb ? `${secondDisb}/${firstDisb} 2nd tranche` : "no disbursals yet" },
    { key: "transaction_volume", label: "Transaction volume", stars: s4, detail: `${total} loan${total === 1 ? "" : "s"}` },
    { key: "repeat_business", label: "Repeat business", stars: s5, detail: `${repeat} repeat customer${repeat === 1 ? "" : "s"}` },
    { key: "installation_tat", label: "Installation TAT", stars: s6, detail: `${n} disbursed customer${n === 1 ? "" : "s"}` },
  ];
  const sum = criteria.reduce((a, c) => a + c.stars, 0);
  const totalScore = Math.round((sum / (criteria.length * 5)) * 100);
  return { total: totalScore, stars: Math.round(totalScore / 20), criteria };
}

// Compact star + /100 badge for the EPC profile header (and anywhere else).
export function ScoreBadge({ total, size = "sm" }: { total: number | null | undefined; size?: "sm" | "lg" }) {
  if (total == null) return null;
  const stars = Math.round(total / 20);
  const lg = size === "lg";
  return (
    <span className={"inline-flex items-center gap-1 rounded-full bg-[#fff7e6] border border-[#f5d98a] text-[#8a5a00] font-semibold " + (lg ? "px-2.5 py-0.5 text-[13px]" : "px-2 py-0.5 text-[11px]")}>
      <span className="text-[#f5a524]">{"★".repeat(stars)}{"☆".repeat(5 - stars)}</span>
      {total}/100
    </span>
  );
}
