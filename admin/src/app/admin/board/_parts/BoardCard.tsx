"use client";

// Task Manager — one kanban card: name, lender chip, amount, days in stage; the fill colour is the SLA status.

import { SOURCE_META, type OpsCase, type CaseSource } from "@/lib/ops-board";
import { fmtRupees } from "@/lib/money";
import { attention, loanOutline, OUTLINE_FILL } from "./rules";

export default function BoardCard({ c, srcFilter, sla, picked, canDrag, isMainAdmin, onSelect, onStartDrag }: {
  c: OpsCase; srcFilter: "all" | CaseSource; sla: number; picked: boolean; canDrag: boolean; isMainAdmin: boolean;
  onSelect: () => void; onStartDrag: () => void;
}) {
  const sm = SOURCE_META[c.source];
  // Loans use per-stage timing (change #2/3/5/7); other sources use idle-vs-SLA.
  const lvl = c.source === "loan" ? loanOutline(c) : attention(c, sla);
  const late = lvl === "red";
  // Colour is now the INNER fill (SLA status), not a border:
  // green within SLA, amber approaching, red breached/blocked.
  // Terminal cards (rejected / aborted, any source) are grey.
  const fill = (c.outcome === "rejected" || c.column === "abort") ? OUTLINE_FILL.neutral : OUTLINE_FILL[lvl];
  // Days the case has sat in its CURRENT stage (e.g. "7d" since it was
  // approved / disbursed). Total days-worked lives in the side panel.
  const stageDays = Math.max(0, Math.floor(c.stageHours / 24));
  // Top-right chip: the LENDER (loan) / partner (insurance) in a single-
  // source view; the source tag only in the mixed "All" view.
  const chip = srcFilter === "all" ? sm.label : c.lender;
  return (
    <button type="button" onClick={onSelect}
      draggable={canDrag} onDragStart={(e) => { if (!canDrag) { e.preventDefault(); return; } onStartDrag(); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", c.id); } catch { /* ignore */ } }}
      className={"text-left rounded-lg border border-line p-2.5 transition-all duration-150 will-change-transform" + (canDrag ? " cursor-grab active:cursor-grabbing" : " cursor-pointer")}
      // No coloured boundary — the SLA status is the inner fill now.
      // Selection lifts the card (shadow + raise).
      style={{ backgroundColor: fill, transform: picked ? "translateY(-3px)" : undefined, boxShadow: picked ? "0 12px 26px -8px rgba(15,23,42,0.45)" : "0 1px 2px rgba(15,23,42,0.06)", position: picked ? "relative" : undefined, zIndex: picked ? 1 : undefined }}>
      <div className="flex items-center justify-between gap-2">
        <strong className="text-[13.5px] font-semibold text-text truncate">{c.name}</strong>
        {chip && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
            style={srcFilter === "all" ? { backgroundColor: sm.tint, color: sm.color } : { backgroundColor: "#eef2f7", color: "#334155" }}>
            {chip}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 mt-1 min-w-0">
        <span className="text-[12.5px] font-bold text-cc-ink truncate">
          {c.amount ? fmtRupees(c.amount) : <span className="text-[11px] font-normal text-text-muted">{c.statusLabel}</span>}
        </span>
        <span className="text-[11px] font-semibold shrink-0" style={{ color: late ? "#b45309" : "#5a8a76" }}>
          {late && "⚠ "}🕒 {stageDays}d in stage
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-1.5 min-w-0">
        {c.epcName ? <span className="text-[11px] text-text-muted truncate">{c.epcName}</span> : <span />}
        {isMainAdmin && c.ownerName && <span className="text-[10px] font-medium text-text-muted shrink-0">{c.ownerName}</span>}
      </div>
      {c.onHold && <div className="text-[10px] font-semibold text-amber-700 mt-0.5">⏸ On hold</div>}
      {c.blocker && <div className="text-[10px] text-text-muted truncate mt-0.5">{c.blocker.slice(0, 30)}</div>}
    </button>
  );
}
