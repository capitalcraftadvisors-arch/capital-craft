"use client";

// EPC View · the Active stage's EPC Health card: score, period, RESI / C&I / Total
// metrics and the installation-TAT bands.

import { scoreTone, type EpcHealth, type HealthBucket, type TatBands } from "@/lib/epc-score";
import type { Period } from "@/lib/period";

export function EpcHealthPanel({ health, hPeriod, setHPeriod, healthTab, setHealthTab }: {
  health: EpcHealth | null;
  hPeriod: Period | "all"; setHPeriod: (p: Period | "all") => void;
  healthTab: "res" | "com" | "total"; setHealthTab: (t: "res" | "com" | "total") => void;
}) {
  return (
    <div className="pt-6">
      <div className="rounded-[14px] border border-cc-line bg-cc-soft p-5 sm:p-6">
        {/* Header — title (left) · EPC score + period (right). */}
        <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
          <div className="text-[20px] font-bold text-cc-ink leading-tight">EPC Health</div>
          <div className="flex items-center gap-2.5 flex-wrap justify-end">
            {health && <HeaderScore score={health.score} />}
            <select
              value={hPeriod}
              onChange={(e) => setHPeriod(e.target.value as Period | "all")}
              className="rounded-input border border-cc-line bg-white px-3 py-2 text-[13px] font-medium text-cc-ink outline-none focus:border-cc-green cursor-pointer shrink-0"
            >
              <option value="all">All time</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="quarter">This Quarter</option>
              <option value="year">This Year</option>
            </select>
          </div>
        </div>

        {!health ? (
          <div className="rounded-[12px] border border-cc-line-soft bg-white p-6 text-center text-[14px] text-cc-muted">
            No applications in this period yet.
          </div>
        ) : (() => {
          const TABS = [
            { key: "res" as const, label: "RESI" },
            { key: "com" as const, label: "C&I" },
            { key: "total" as const, label: "Total" },
          ];
          const b = health[healthTab];
          return (
            <>
              {/* Segment tabs */}
              <div className="inline-flex rounded-[10px] border border-cc-line overflow-hidden bg-white mb-3">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setHealthTab(t.key)}
                    className={
                      "px-4 py-1.5 text-[13px] font-semibold border-r border-cc-line last:border-r-0 transition-colors " +
                      (healthTab === t.key ? "bg-cc-green text-white" : "text-cc-ink bg-white hover:bg-cc-wash")
                    }
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Total tab → paired metrics (left) + portfolio signals (right
                  column) + Installation TAT below. Other tabs: metrics full-width. */}
              {healthTab === "total" ? (
                <>
                  <div className="grid gap-3 lg:grid-cols-3 items-stretch">
                    <div className="lg:col-span-2"><MetricsCard b={b} /></div>
                    <div className="flex flex-col gap-3">
                      <MiniStat className="flex-1" label="Transaction volume" value={numFmt(health.volume)} />
                      <MiniStat className="flex-1" label="Repeat customers" value={numFmt(health.repeat)} />
                    </div>
                  </div>
                  <TatCard tat={health.tat} className="mt-3" />
                </>
              ) : (
                <MetricsCard b={b} />
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}

// ── EPC Health formatters + cards ────────────────────────────────────
const numFmt  = (v: number) => v.toLocaleString("en-IN");
const pctFmt  = (r: number) => `${Math.round(r * 100)}%`;
const lacsFmt = (v: number) => `₹${(v / 100000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} Lacs`;

// One paired metric row inside a segment tab (label left, value right).
function HealthRow({ label, value, accent, green }: { label: string; value: string; accent?: boolean; green?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-grey-line">
      <span className="text-[15px] text-slate-700">{label}</span>
      <span className={"text-[15px] font-semibold " + (green ? "text-cc-green" : accent ? "text-cc-blue" : "text-cc-ink")}>
        {value}
      </span>
    </div>
  );
}

// The full paired-metrics card for a segment (Applications↔Approval ratio, etc.).
function MetricsCard({ b }: { b: HealthBucket }) {
  return (
    <div className="rounded-[12px] border border-cc-line-soft bg-white p-4 sm:p-5 h-full">
      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-0">
        <HealthRow label="Applications Submitted" value={numFmt(b.submitted)} />
        <HealthRow label="Approval ratio" value={pctFmt(b.approvalRatio)} accent />
        <HealthRow label="Rejected" value={numFmt(b.rejected)} />
        <HealthRow label="Cancellation ratio" value={pctFmt(b.cancellationRatio)} />
        <HealthRow label="Approval Amount" value={lacsFmt(b.approvalAmount)} green />
        <HealthRow label="Disbursed" value={lacsFmt(b.disbursed)} />
        <HealthRow label="Pending Disbursed" value={lacsFmt(b.pending)} />
      </div>
    </div>
  );
}

// A small headline stat card (transaction volume / repeat customers).
function MiniStat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={"rounded-[12px] border border-cc-line-soft bg-white p-4 flex flex-col justify-center " + (className ?? "")}>
      <div className="text-[12px] font-semibold uppercase tracking-wide text-cc-muted">{label}</div>
      <div className="text-[26px] font-bold text-cc-ink mt-1 leading-none">{value}</div>
    </div>
  );
}

// The blended EPC score as a compact header pill, coloured by band
// (strong / fair / needs attention).
function HeaderScore({ score }: { score: number }) {
  const t = scoreTone(score);
  return (
    <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 shrink-0" style={{ backgroundColor: t.bg, borderColor: t.border }}>
      <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: t.text }}>EPC Score</span>
      <span className="text-[17px] font-bold leading-none" style={{ color: t.text }}>{score}</span>
      <span className="text-[11px] font-semibold" style={{ color: t.text }}>/100 · {t.label}</span>
    </span>
  );
}

// Installation-TAT ageing bands. The whole card takes the colour of whichever
// band holds the most in-progress applications (older band wins ties).
function TatCard({ tat, className }: { tat: TatBands; className?: string }) {
  const TONE: Record<string, { dot: string; text: string; label: string }> = {
    green:  { dot: "#16a34a", text: "#0f7a52", label: "On track" },
    yellow: { dot: "#eab308", text: "#8a5a00", label: "Watch" },
    red:    { dot: "#dc2626", text: "#b42318", label: "High alert" },
    none:   { dot: "#cbd5e1", text: "#5a8a76", label: "Nothing in progress" },
  };
  const t = TONE[tat.alert];
  const bands = [
    { label: "≤ 60 days", value: tat.le60, color: "#16a34a", active: tat.alert === "green" },
    { label: "60–90 days", value: tat.d60_90, color: "#eab308", active: tat.alert === "yellow" },
    { label: "> 90 days", value: tat.gt90, color: "#dc2626", active: tat.alert === "red" },
  ];
  return (
    <div className={"rounded-[12px] border border-cc-line-soft bg-white p-4 " + (className ?? "")}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-cc-muted">Installation TAT</div>
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: t.text }}>
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.dot }} />
          {t.label}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {bands.map((band) => (
          <div key={band.label}
            className="rounded-[10px] border px-3 py-2.5 text-center"
            style={{ borderColor: band.active ? band.color : "#eef1f4", backgroundColor: band.active ? band.color + "14" : "#fbfdfc" }}>
            <div className="text-[22px] font-bold" style={{ color: band.color }}>{band.value}</div>
            <div className="text-[11px] font-medium text-cc-muted mt-0.5">{band.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
