"use client";

// The applied loan amount as a share of the project cost: 80 % / 90 % / 100 %
// fill the amount in; "Custom" is for typing any other amount. One picker for
// every place the applied loan amount is asked — the partner and team chats,
// the classic loan forms and the lead form.

import { amountInput } from "@/lib/money";

export const LOAN_SHARES = [80, 90, 100] as const;

/** `pct` % of the project cost, to the paisa. */
export const loanShare = (cost: number, pct: number) => Math.round(cost * pct) / 100;

export default function LoanShareChips({ cost, value, onPick, onCustom, tone = "#178a5c" }: {
  cost: number;                         // the project cost (0 / missing → the % buttons are off)
  value: string;                        // the amount in the box
  onPick: (amount: string) => void;     // sets the box
  onCustom?: () => void;                // e.g. focus the box
  tone?: string;                        // the selected button's colour
}) {
  const n = Number(amountInput(value));
  const ok = cost > 0;
  const match = ok && n > 0 ? LOAN_SHARES.find((p) => loanShare(cost, p) === n) ?? null : null;
  const custom = match == null && n > 0;
  const cls = (on: boolean) => [
    "px-3 py-1.5 rounded-full text-[12.5px] font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
    on ? "text-white border-transparent" : "bg-white border-line text-text-mid hover:text-text",
  ].join(" ");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {LOAN_SHARES.map((p) => (
        <button key={p} type="button" disabled={!ok} title={ok ? undefined : "Enter the project cost first"}
          onClick={() => onPick(String(loanShare(cost, p)))}
          className={cls(match === p)} style={match === p ? { background: tone } : undefined}>
          {p}%
        </button>
      ))}
      <button type="button" onClick={() => { if (match != null) onPick(""); onCustom?.(); }}
        className={cls(custom)} style={custom ? { background: tone } : undefined}>
        Custom
      </button>
    </div>
  );
}
