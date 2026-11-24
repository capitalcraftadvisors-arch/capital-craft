"use client";

// Partner dashboard · the Insurance section (search, filter chips, the policy table; v2 adds Due for renewal + Renew).

import { useState } from "react";
import { NAVY_ACCENT } from "@/components/partner/PartnerShell";
import { policyValidityParts, INSURANCE_STATUS_LABEL, VALIDITY_TEXT } from "@/lib/insurance-validity";
import { fmtRupees } from "@/lib/money";
import { INS_STATUS_PILL, fmtDateTimeOrBlank, type InsFilter, type InsRow } from "./rows";
import SearchChips from "./SearchChips";

// ── Insurance ─────────────────────────────────────────────────────────────────
export default function InsuranceSection({ insRows, loading, onApply, applying, onOpen, v2 = false, initial = "all", onRenew = null }: {
  insRows: InsRow[]; loading: boolean; onApply: (() => void) | null; applying: boolean; onOpen: (id: string) => void;
  v2?: boolean; initial?: InsFilter; onRenew?: (() => void) | null; // Partner Portal v2: Due for renewal + Renew
}) {
  const [q, setQ] = useState("");
  const [sf, setSf] = useState<InsFilter>(v2 || initial !== "renewal" ? initial : "all");
  const daysLeft = (r: InsRow) => policyValidityParts(r.policy_from_date, r.policy_to_date)?.daysLeft ?? null;
  const isExpiring = (r: InsRow) => { const d = daysLeft(r); return d !== null && d >= 0 && d <= 30; };
  // An issued policy ending within 30 days either side of today (the dashboard's Insurance due).
  const isRenewal = (r: InsRow) => { const d = daysLeft(r); return r.status === "issued" && d !== null && d >= -30 && d <= 30; };
  const canRenew = (r: InsRow) => { const d = daysLeft(r); return !!onRenew && r.status === "issued" && d !== null && d <= 30; };
  const matches = (r: InsRow, k: InsFilter) => (k === "all" ? true : k === "expiring" ? isExpiring(r) : k === "renewal" ? isRenewal(r) : r.status === k);
  const count = (k: InsFilter) => insRows.filter((r) => matches(r, k)).length;
  const needle = q.trim().toLowerCase();
  const filtered = [...insRows]
    .sort((a, b) => (b.attention_status === "open" ? 1 : 0) - (a.attention_status === "open" ? 1 : 0))
    .filter((r) => {
      if (!matches(r, sf)) return false;
      if (needle && !((r.aadhaar_name || "").toLowerCase().includes(needle) || (r.insurance_display_id || "").toLowerCase().includes(needle))) return false;
      return true;
    });
  const CHIPS: { key: InsFilter; label: string }[] = [
    { key: "all", label: "All" }, { key: "under_review", label: "Under review" }, { key: "issued", label: "Issued" },
    { key: "hold", label: "Hold" }, { key: "rejected", label: "Rejected" }, { key: "expiring", label: "Expiring soon" },
    ...(v2 ? [{ key: "renewal" as const, label: "Due for renewal" }] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h2 className="font-display text-[20px] font-bold text-cc-ink">Your insurance applications</h2></div>
        {onApply && <button onClick={onApply} disabled={applying} className="px-4 py-2 rounded-xl text-white text-[13px] font-semibold disabled:opacity-60" style={{ background: NAVY_ACCENT }}>{applying ? "Starting…" : "Apply for insurance"}</button>}
      </div>

      {/* Search + status/expiry filters */}
      <SearchChips q={q} onQ={setQ} placeholder="Search by insured or INS ID…" chips={CHIPS} active={sf} onPick={setSf} count={count} />

      <div className="bg-white rounded-2xl border border-line overflow-x-auto">
        <table className="w-full text-[14px] min-w-[720px]">
          <thead className="bg-bg-soft border-b border-line"><tr className="text-left text-text-muted text-[12px]">
            <th className="px-5 py-3 font-medium">Insured name</th><th className="px-5 py-3 font-medium">Sum insured</th><th className="px-5 py-3 font-medium">Insurance partner</th>
            <th className="px-5 py-3 font-medium">Status</th><th className="px-5 py-3 font-medium">Policy validity</th><th className="px-5 py-3 font-medium">Created on</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="px-5 py-8 text-center text-text-muted">Loading…</td></tr>
              : insRows.length === 0 ? <tr><td colSpan={6} className="px-5 py-12 text-center text-text-muted">No insurance applications yet.</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={6} className="px-5 py-12 text-center text-text-muted">No applications match your search or filter.</td></tr>
              : filtered.map((r) => (
                <tr key={r.id} onClick={() => onOpen(r.id)} className="border-b border-line cursor-pointer hover:bg-cc-wash">
                  <td className="px-5 py-4"><div className="text-[15px] font-semibold text-text">{r.aadhaar_name || "—"}</div>{r.insurance_display_id && <div className="text-[12px] font-mono text-cc-blue mt-0.5">{r.insurance_display_id}</div>}{r.attention_status === "open" && <div className="mt-1"><span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Action needed</span></div>}</td>
                  <td className="px-5 py-4 font-semibold text-cc-ink">{fmtRupees(r.sum_insured ?? r.invoice_confirmed_amount)}</td>
                  <td className="px-5 py-4">{r.insurance_partner || "—"}</td>
                  <td className="px-5 py-4"><span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide ${INS_STATUS_PILL[r.status] ?? INS_STATUS_PILL.draft}`}>{INSURANCE_STATUS_LABEL[r.status] ?? r.status}</span></td>
                  <td className="px-5 py-4">
                    {(() => { const v = policyValidityParts(r.policy_from_date, r.policy_to_date); return v ? <span className={`text-[12px] font-medium ${VALIDITY_TEXT[v.tone]}`}>{v.text}</span> : <span className="text-text-muted">—</span>; })()}
                    {canRenew(r) && (
                      <div className="mt-1.5">
                        <button type="button" disabled={applying} onClick={(e) => { e.stopPropagation(); onRenew?.(); }}
                          className="px-3 py-1 rounded-lg border border-navy text-navy text-[12px] font-semibold hover:bg-navy/[0.06] disabled:opacity-60">
                          {applying ? "Starting…" : "Renew"}
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-4 text-text-muted whitespace-nowrap">{fmtDateTimeOrBlank(r.created_at)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
