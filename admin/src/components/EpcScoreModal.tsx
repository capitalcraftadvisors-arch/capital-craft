"use client";

// Capital Craft EPC Score — admin rates an EPC on nine criteria (1–5 stars
// each); the /100 total is (sum of stars ÷ 45 × 100), i.e. every criterion
// weighs the same. Opened from the EPC profile's ⋯ menu ("Add EPC score").
// Saves straight to epc_business (admin-only RLS) and reports the new total
// back so the page header + dashboard list update immediately.

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { getBusiness } from "@/lib/auth";

// key → label, in the order the business defined them.
export const SCORE_CRITERIA: { key: string; label: string }[] = [
  { key: "application_quality", label: "Application quality" },
  { key: "approval_ratio", label: "Approval ratio" },
  { key: "cancellation_ratio", label: "Cancellation ratio" },
  { key: "document_quality", label: "Document quality" },
  { key: "installation_tat", label: "Installation TAT" },
  { key: "second_tranche", label: "Second tranche completion" },
  { key: "customer_complaints", label: "Customer complaints" },
  { key: "transaction_volume", label: "Transaction volume" },
  { key: "repeat_business", label: "Repeat business" },
];
const MAX = SCORE_CRITERIA.length * 5; // 45

export function scoreTotal(ratings: Record<string, number>): number {
  const sum = SCORE_CRITERIA.reduce((s, c) => s + (Number(ratings[c.key]) || 0), 0);
  return Math.round((sum / MAX) * 100);
}

export default function EpcScoreModal({
  open, onClose, businessId, initial, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  businessId: string;
  initial?: Record<string, any> | null;
  onSaved: (total: number, score: Record<string, any>) => void;
}) {
  const seed: Record<string, number> = {};
  for (const c of SCORE_CRITERIA) seed[c.key] = Number(initial?.[c.key]) || 0;
  const [ratings, setRatings] = useState<Record<string, number>>(seed);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) return null;

  const total = scoreTotal(ratings);
  const rated = SCORE_CRITERIA.filter((c) => ratings[c.key] > 0).length;
  const set = (key: string, n: number) => setRatings((r) => ({ ...r, [key]: r[key] === n ? 0 : n }));

  async function save() {
    if (rated === 0) { setErr("Rate at least one criterion."); return; }
    setBusy(true); setErr(null);
    const me = getBusiness();
    const score = {
      ...ratings,
      total,
      rated_by_name: me?.contact_name ?? null,
      rated_at: new Date().toISOString(),
    };
    const { error } = await supabase().from("epc_business")
      .update({ epc_score: score, epc_score_total: total }).eq("id", businessId);
    setBusy(false);
    if (error) { setErr("Couldn't save the score: " + error.message); return; }
    onSaved(total, score);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-white rounded-[12px] shadow-lg p-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-2 mb-3">
          <h3 className="text-[17px] font-bold text-[#0f3d2e]">Capital Craft EPC Score</h3>
          <button type="button" onClick={onClose} className="text-[18px] text-text-muted hover:text-text leading-none p-1">✕</button>
        </div>

        {/* Live total */}
        <div className="flex items-center justify-between rounded-[10px] bg-[#f0faf5] border border-[#cdeadd] px-4 py-3 mb-3">
          <div className="flex items-center gap-1 text-[#f5a524] text-[18px] leading-none">
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n}>{n <= Math.round(total / 20) ? "★" : "☆"}</span>
            ))}
          </div>
          <div className="text-[20px] font-bold text-[#0f3d2e]">{total}<span className="text-[13px] font-medium text-[#5a8a76]">/100</span></div>
        </div>

        <div className="divide-y divide-line border border-line rounded-[10px]">
          {SCORE_CRITERIA.map((c) => (
            <div key={c.key} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="text-[13px] text-text-mid">{c.label}</span>
              <div className="flex items-center gap-1 shrink-0 text-[20px] leading-none">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => set(c.key, n)} aria-label={`${c.label}: ${n} star`}
                    className={"transition-colors " + (n <= (ratings[c.key] || 0) ? "text-[#f5a524]" : "text-[#d4dbd7] hover:text-[#f5c56a]")}>
                    {n <= (ratings[c.key] || 0) ? "★" : "☆"}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {err && <div className="mt-3 p-2.5 rounded-input bg-red-50 border border-red-200 text-[12px] text-red-700">{err}</div>}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 rounded-lg border border-line text-[13px] text-text-mid disabled:opacity-60">Cancel</button>
          <button type="button" onClick={() => void save()} disabled={busy} className="px-5 py-2 rounded-lg bg-[#178a5c] text-white text-[13px] font-semibold disabled:opacity-60">{busy ? "Saving…" : "Save score"}</button>
        </div>
      </div>
    </div>
  );
}

// Compact score badge for the profile header + dashboard list (no extra column).
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
