// Capital Craft — EPC Health + Score, computed AUTOMATICALLY from the EPC's
// own loan history (no manual entry, no stars). One engine feeds the merged
// "EPC Health" card on the EPC profile:
//   • Per-segment health (RESI / C&I / Total): submitted, rejected, approval &
//     cancellation ratios, approval (sanctioned) amount, disbursed, pending.
//   • Portfolio signals (shown on the Total tab): transaction volume, repeat
//     customers, Installation-TAT ageing bands, and a single EPC Score /100.
//
// The score blends five measurable signals (tune the weights in ONE place —
// SCORE_WEIGHTS below):
//   approval ratio ·  cancellation (lower = better) ·  installation speed ·
//   transaction volume ·  repeat business.
//
// Installation TAT — there is no "installation-complete" date in the schema, so
// we age each in-progress application (submitted, not rejected, not yet fully
// disbursed) by days since it was created:
//   ≤ 60 days → on track (green) · 60–90 days → watch (yellow) · > 90 days →
//   alert (red). The whole metric's alert colour is whichever band holds the
//   MOST applications (older band wins ties).

export type EpcLoan = {
  status?: string | null;
  plant_use_type?: string | null;
  loan_display_id?: string | null;
  sanctioned_amount?: number | null;
  first_disbursement_amount?: number | null;
  second_disbursement_amount?: number | null;
  created_at?: string | null;
  borrower_pan?: string | null;
  borrower_mobile?: string | null;
};

const APPROVED = new Set(["approved", "rfd", "sent_to_nbfc", "disbursed"]);

export type HealthBucket = {
  submitted: number;
  approved: number;
  rejected: number;
  approvalRatio: number;      // 0..1
  cancellationRatio: number;  // 0..1
  approvalAmount: number;     // sanctioned amount (₹)
  disbursed: number;          // 1st + 2nd tranche (₹)
  pending: number;            // approvalAmount − disbursed (₹, floored at 0)
};

export type AlertLevel = "green" | "yellow" | "red" | "none";
export type TatBands = {
  le60: number;      // ≤ 60 days in progress
  d60_90: number;    // 60–90 days
  gt90: number;      // > 90 days
  alert: AlertLevel; // dominant band → overall colour
};

export type ScorePart = { key: string; label: string; pct: number; weight: number };
export type EpcHealth = {
  res: HealthBucket;
  com: HealthBucket;
  total: HealthBucket;
  volume: number;   // total submitted applications
  repeat: number;   // borrowers with more than one application
  tat: TatBands;
  score: number;    // 0..100
  parts: ScorePart[];
};

// Weights for the blended EPC Score (must be meaningful relative to each other;
// they're renormalised over whichever signals have data).
const SCORE_WEIGHTS = {
  approval: 30,
  cancellation: 20,
  installation: 25,
  volume: 15,
  repeat: 10,
} as const;

const nz = (v: unknown): number => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);
const DAY = 86400000;
function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / DAY));
}

function isRes(l: EpcLoan): boolean {
  return (l.loan_display_id || "").toUpperCase().startsWith("CC-RES") || l.plant_use_type === "residential";
}
function isCom(l: EpcLoan): boolean {
  return (l.loan_display_id || "").toUpperCase().startsWith("CC-COM") || l.plant_use_type === "commercial";
}

function bucket(rows: EpcLoan[]): HealthBucket {
  const submitted = rows.length; // caller passes non-draft rows only
  const approved = rows.filter((r) => r.first_disbursement_amount != null || (r.status ? APPROVED.has(r.status) : false)).length;
  const rejected = rows.filter((r) => r.status === "rejected").length;
  const approvalAmount = rows.reduce((s, r) => s + nz(r.sanctioned_amount), 0);
  const disbursed = rows.reduce((s, r) => s + nz(r.first_disbursement_amount) + nz(r.second_disbursement_amount), 0);
  return {
    submitted,
    approved,
    rejected,
    approvalRatio: submitted ? approved / submitted : 0,
    cancellationRatio: submitted ? rejected / submitted : 0,
    approvalAmount,
    disbursed,
    pending: Math.max(0, approvalAmount - disbursed),
  };
}

// An application still "in installation" — submitted, not rejected, and its 2nd
// (final) tranche not yet paid.
function inProgress(l: EpcLoan): boolean {
  return l.status !== "rejected" && l.second_disbursement_amount == null;
}

export function computeEpcHealth(all: EpcLoan[]): EpcHealth | null {
  const loans = all.filter((l) => l.status !== "draft"); // drafts aren't a transaction
  if (loans.length === 0) return null;

  const res = bucket(loans.filter(isRes));
  const com = bucket(loans.filter(isCom));
  const total = bucket(loans);

  const volume = total.submitted;

  // Repeat business — borrowers that appear more than once (keyed by PAN, else mobile).
  const counts = new Map<string, number>();
  for (const l of loans) {
    const k = (l.borrower_pan || "").toUpperCase() || (l.borrower_mobile || "");
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  }
  const repeat = [...counts.values()].filter((c) => c > 1).length;

  // Installation-TAT ageing bands over in-progress applications.
  let le60 = 0, d60_90 = 0, gt90 = 0;
  for (const l of loans.filter(inProgress)) {
    const d = daysSince(l.created_at);
    if (d > 90) gt90++;
    else if (d > 60) d60_90++;
    else le60++;
  }
  const bandTotal = le60 + d60_90 + gt90;
  const alert: AlertLevel = bandTotal === 0 ? "none"
    : gt90 >= d60_90 && gt90 >= le60 && gt90 > 0 ? "red"
    : d60_90 >= le60 && d60_90 > 0 ? "yellow"
    : "green";
  const tat: TatBands = { le60, d60_90, gt90, alert };

  // ── Blend the EPC Score (each signal → 0..100) ──
  const parts: ScorePart[] = [];
  parts.push({ key: "approval", label: "Approval ratio", pct: Math.round(total.approvalRatio * 100), weight: SCORE_WEIGHTS.approval });
  parts.push({ key: "cancellation", label: "Low cancellation", pct: Math.round((1 - total.cancellationRatio) * 100), weight: SCORE_WEIGHTS.cancellation });
  // Installation speed — on-track weighted 100, watch 50, alert 0. Only when
  // there ARE in-progress apps to judge.
  if (bandTotal > 0) {
    const installPct = Math.round(((le60 * 100 + d60_90 * 50 + gt90 * 0) / bandTotal));
    parts.push({ key: "installation", label: "Installation speed", pct: installPct, weight: SCORE_WEIGHTS.installation });
  }
  parts.push({ key: "volume", label: "Transaction volume", pct: Math.min(100, Math.round((volume / 20) * 100)), weight: SCORE_WEIGHTS.volume });
  parts.push({ key: "repeat", label: "Repeat business", pct: Math.min(100, repeat * 25), weight: SCORE_WEIGHTS.repeat });

  const wSum = parts.reduce((s, p) => s + p.weight, 0);
  const score = wSum ? Math.round(parts.reduce((s, p) => s + p.pct * p.weight, 0) / wSum) : 0;

  return { res, com, total, volume, repeat, tat, score, parts };
}

// Score → traffic-light colour (used by the profile card).
export function scoreTone(score: number): { text: string; bg: string; border: string; label: string } {
  if (score >= 70) return { text: "#0f7a52", bg: "#e6f6ee", border: "#bfe6d5", label: "Strong" };
  if (score >= 40) return { text: "#8a5a00", bg: "#fff7e6", border: "#f5d98a", label: "Fair" };
  return { text: "#b42318", bg: "#fdecea", border: "#f5c2bd", label: "Needs attention" };
}
