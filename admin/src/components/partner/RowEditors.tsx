"use client";

// Editable row lists shared by Quotation preferences and the quote editor:
// the payment schedule (stage + %, shown against 100 %) and pairs such as the
// warranty rows (component + warranty).

import { input } from "@/components/quotation/form-kit";
import type { PaymentStage } from "@/lib/quotation-brands";

export function AddBtn({ onClick, label = "+ Add row" }: { onClick: () => void; label?: string }) {
  return <button type="button" onClick={onClick} className="text-[13px] font-semibold text-[#1e3a8a] hover:underline">{label}</button>;
}

export function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Remove row" title="Remove row" className="p-2 rounded-lg text-red-600 hover:bg-red-50 shrink-0">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
    </button>
  );
}

export const paymentTotal = (rows: PaymentStage[]) => rows.reduce((a, [, pct]) => a + (Number(pct) || 0), 0);

export function PaymentRows({ rows, onChange }: { rows: PaymentStage[]; onChange: (rows: PaymentStage[]) => void }) {
  const total = paymentTotal(rows);
  return (
    <div className="flex flex-col gap-2">
      {rows.map(([stage, pct], i) => (
        <div key={i} className="flex gap-2 items-center">
          <input className={input} value={stage} placeholder="Stage"
            onChange={(e) => onChange(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} />
          <div className="relative w-[96px] shrink-0">
            <input className={input + " pr-7 text-right"} inputMode="decimal" value={String(pct)}
              onChange={(e) => onChange(rows.map((r, j) => (j === i ? [r[0], Number(e.target.value.replace(/[^\d.]/g, "")) || 0] : r)))} />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-text-muted">%</span>
          </div>
          <RemoveBtn onClick={() => onChange(rows.filter((_, j) => j !== i))} />
        </div>
      ))}
      <div className="flex items-center justify-between gap-3">
        <AddBtn onClick={() => onChange([...rows, ["", 0]])} />
        <span className={"text-[13px] font-semibold " + (Math.abs(total - 100) > 0.001 ? "text-red-600" : "text-[#178a5c]")}>{total}%</span>
      </div>
    </div>
  );
}

export function PairRows({ rows, onChange, placeholders }: { rows: [string, string][]; onChange: (rows: [string, string][]) => void; placeholders: [string, string] }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map(([a, b], i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[220px_1fr_auto] items-center">
          <input className={input} value={a} placeholder={placeholders[0]} onChange={(e) => onChange(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} />
          <input className={input} value={b} placeholder={placeholders[1]} onChange={(e) => onChange(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} />
          <RemoveBtn onClick={() => onChange(rows.filter((_, j) => j !== i))} />
        </div>
      ))}
      <div><AddBtn onClick={() => onChange([...rows, ["", ""]])} /></div>
    </div>
  );
}
