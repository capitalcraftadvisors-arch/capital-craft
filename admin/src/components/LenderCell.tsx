"use client";

import { useEffect, useRef, useState } from "react";

// Lender registry + per-EPC state. Shared by the admin table and the EPC
// profile action bar so both render the identical "Lender status" dropdown.
export type Lender = string;
export type LenderInfo = { key: string; label: string; sort_order?: number };
export type LenderState = { docs_given: boolean; approved: boolean; rejected: boolean };
export type LenderMap = Partial<Record<Lender, LenderState>>;

export default function LenderCell({
  state, lenders, onSet, onAddLender,
}: {
  state: LenderMap;
  lenders: LenderInfo[];
  onSet: (lender: Lender, target: "none" | "docs" | "approved" | "rejected") => void;
  onAddLender: (name: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // One exclusive state per lender.
  const stateOf = (key: string): "none" | "docs" | "approved" | "rejected" => {
    const s = state[key];
    if (!s) return "none";
    if (s.approved) return "approved";
    if (s.rejected) return "rejected";
    if (s.docs_given) return "docs";
    return "none";
  };
  const sorted = [...lenders].sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100));
  const approvedL = sorted.filter((l) => stateOf(l.key) === "approved"); // TOP
  const rejectedL = sorted.filter((l) => stateOf(l.key) === "rejected"); // BOTTOM
  const middleL   = sorted.filter((l) => stateOf(l.key) === "none" || stateOf(l.key) === "docs");
  const anySet = approvedL.length > 0 || rejectedL.length > 0 || middleL.some((l) => stateOf(l.key) === "docs");

  function place() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const W = 340, H = 380, M = 8;              // panel width, est. max height, viewport margin
    const vw = window.innerWidth, vh = window.innerHeight;
    const roomBelow = vh - r.bottom - M;
    const roomAbove = r.top - M;
    const left = Math.max(M, Math.min(r.right - W, vw - W - M));
    // When there isn't room below and there's more above, open UPWARD by
    // anchoring the panel's BOTTOM just above the button — so it stays attached
    // to the row regardless of its actual height (was floating away before).
    if (roomBelow < H && roomAbove > roomBelow) {
      setPos({ bottom: vh - r.top + 6, left });
    } else {
      setPos({ top: r.bottom + 6, left });
    }
  }
  function toggle() { if (!open) place(); setOpen((o) => !o); }

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  async function submitAdd() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try { await onAddLender(name); setNewName(""); }
    finally { setAdding(false); }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-input border border-line bg-white hover:bg-bg-soft text-[#0f3d2e] max-w-full"
      >
        <span className={anySet ? "text-[#0f3d2e]" : "text-text-muted"}>{anySet ? "Lender status" : "Set lender status"}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0"><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && pos && (
        <div
          ref={panelRef}
          style={{ position: "fixed", top: pos.top, bottom: pos.bottom, left: pos.left, width: 340, maxHeight: "calc(100vh - 16px)", zIndex: 60 }}
          className="rounded-lg border border-line bg-white shadow-xl overflow-hidden text-left"
        >
          <div className="px-3 py-2 border-b border-line bg-[#f0faf5] text-[11px] font-semibold uppercase tracking-wide text-[#5a8a76]">
            Lender status
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>

            {/* APPROVED — top, green. Click to un-approve → back to Docs Sent. */}
            {approvedL.map((l) => (
              <button key={l.key} type="button" onClick={() => onSet(l.key, "docs")} title="Click to un-approve"
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 border-b border-[#d6efe3] bg-[#e6f6ee] hover:bg-[#d6efe3] text-left">
                <span className="font-medium text-[#0f7a52] truncate">{l.label}</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0f7a52] shrink-0">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  Approved
                </span>
              </button>
            ))}

            {/* MIDDLE — three-state control; Approved/Rejected gated on Docs Sent. */}
            {middleL.length > 0 && (
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-[#5a8a76] border-b border-line">
                    <th className="text-left font-medium px-3 py-1.5">Lender</th>
                    <th className="font-medium px-1 py-1.5">Docs sent</th>
                    <th className="font-medium px-1 py-1.5">Approved</th>
                    <th className="font-medium px-1 py-1.5">Rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {middleL.map((l) => {
                    const docs = stateOf(l.key) === "docs";
                    return (
                      <tr key={l.key} className={`border-b border-[#f0f4f2] ${docs ? "bg-[#f7fcfa]" : ""}`}>
                        <td className="text-left px-3 py-2 font-medium text-[#0f3d2e] whitespace-nowrap">{l.label}</td>
                        <td className="text-center px-1 py-2">
                          <input type="checkbox" checked={docs} onChange={(e) => onSet(l.key, e.target.checked ? "docs" : "none")} className="h-4 w-4 accent-[#185fa5] cursor-pointer" />
                        </td>
                        <td className="text-center px-1 py-2">
                          <input type="checkbox" checked={false} disabled={!docs} onChange={() => onSet(l.key, "approved")}
                            title={docs ? "Mark approved" : "Send docs first"}
                            className="h-4 w-4 accent-[#178a5c] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" />
                        </td>
                        <td className="text-center px-1 py-2">
                          <input type="checkbox" checked={false} disabled={!docs} onChange={() => onSet(l.key, "rejected")}
                            title={docs ? "Mark rejected" : "Send docs first"}
                            className="h-4 w-4 accent-[#dc2626] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {/* Add lender — part of the MIDDLE section (new lenders start undecided). */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-[#fbfdfc]">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submitAdd(); } }}
                placeholder="Add lender…"
                className="flex-1 min-w-0 text-[12px] px-2 py-1.5 rounded-input border border-line focus:outline-none focus:ring-2 focus:ring-[#185fa5]/30"
              />
              <button
                type="button"
                onClick={() => void submitAdd()}
                disabled={adding || !newName.trim()}
                className="text-[12px] font-semibold px-2.5 py-1.5 rounded-input bg-[#185fa5] text-white disabled:opacity-50 shrink-0"
              >
                {adding ? "Adding…" : "Add"}
              </button>
            </div>

            {/* REJECTED — bottom, red. Click to un-reject → back to Docs Sent. */}
            {rejectedL.map((l) => (
              <button key={l.key} type="button" onClick={() => onSet(l.key, "docs")} title="Click to un-reject"
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 border-b border-[#ffd0d4] bg-[#ffe4e6] hover:bg-[#ffd0d4] text-left">
                <span className="font-medium text-[#9f1239] truncate">{l.label}</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#9f1239] shrink-0">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  Rejected
                </span>
              </button>
            ))}

          </div>
        </div>
      )}
    </>
  );
}
