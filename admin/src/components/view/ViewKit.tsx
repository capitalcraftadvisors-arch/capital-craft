"use client";

// ViewKit — the shared presentational kit for the admin full-page "View
// profile" dashboards (EPC View and Loan Application View).
//
// These pieces were originally file-local to the EPC View page. They were
// lifted here VERBATIM so the Loan View can be a true structural copy of the
// EPC View rather than a re-implementation — re-implementing them by hand is
// exactly what made the two pages drift apart before. Both pages now import
// the SAME components, so a styling change lands on both.
//
// Brand palette (from the approved reference):
//   #178a5c  primary green
//   #185fa5  sky blue accent
//   #0f3d2e  dark green text
//   #5a8a76  muted green text
//   #f0faf5  light green tint (admin-only sections)
//   #dceffb  light blue tint (pills / row highlight)
//   #cdeadd  green card border
//   #d3e9f7  blue card border
//   #fef0d6  amber pill bg
//   #854f0b  amber pill text
//
// NOTE: anything domain-specific (EPC stakeholders, lender ticks, loan
// offers) stays in its page. Only layout/chrome lives here.

import React from "react";

// ── Icon set ────────────────────────────────────────────────────────
export const I = {
  building: (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="1" /><path d="M9 21V9M15 21V9M4 9h16M9 6h.01M15 6h.01M9 13h.01M15 13h.01M9 17h.01M15 17h.01" />
    </svg>
  ),
  user: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>),
  users: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>),
  bank: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M3 10h18M12 3 2 8h20l-10-5zM4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/></svg>),
  files: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15h6M9 11h4"/></svg>),
  star: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 15.09 8.26 22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>),
  lock: (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>),
  money: (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/></svg>),
  invoice: (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2h9l5 5v15H6z"/><path d="M15 2v6h5M9 12h6M9 16h6M9 8h3"/></svg>),
  check: (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7"/></svg>),
  send: (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>),
  circleCheck: (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>),
  eye: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 12s3.5-7 10.5-7 10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>),
  edit: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3l4 4-13 13H4v-4z"/></svg>),
  download: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16"/></svg>),
  id: (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="9" cy="12" r="2"/><path d="M14 10h5M14 14h5"/></svg>),
};

// ── Status band buttons (slate palette — deliberately NOT brand green so
// an internal/admin status can't be confused with a lender approval) ──
export function StatusBtn({
  kind, busy, onClick, children,
}: {
  kind: "approve" | "neutral" | "danger";
  busy: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const base = "text-[13px] font-semibold px-3.5 py-1.5 rounded-md border transition-colors disabled:opacity-60";
  const cls =
    kind === "approve" ? "bg-slate-800 text-white border-slate-800 hover:bg-slate-700" :
    kind === "danger"  ? "bg-white text-red-700 border-red-300 hover:bg-red-50" :
                         "bg-white text-slate-700 border-slate-300 hover:bg-slate-100";
  return (
    <button type="button" disabled={busy} onClick={onClick} className={[base, cls].join(" ")}>
      {children}
    </button>
  );
}

export function Pill({ children, tint, icon }: {
  children: React.ReactNode;
  tint: "blue" | "amber";
  icon?: React.ReactNode;
}) {
  const cls = tint === "amber"
    ? "bg-[#fef0d6] text-[#854f0b] font-semibold"
    : "bg-[#dceffb] text-[#185fa5] font-medium";
  return (
    <span className={["inline-flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-[8px]", cls].join(" ")}>
      {icon && <span className="opacity-90">{icon}</span>}
      {children}
    </span>
  );
}

export function BigProgressStep({ icon, done, inProgress, failed, label, sub, mutedIfPending }: {
  icon: React.ReactNode;
  done?: boolean;
  inProgress?: boolean;
  /** Terminal-negative stage (e.g. a rejected decision) — renders red.
   *  Optional and opt-in: callers that omit it render exactly as before. */
  failed?: boolean;
  label: React.ReactNode;
  sub?: React.ReactNode;
  mutedIfPending?: boolean;
}) {
  const bg = failed
    ? "bg-[#dc2626] text-white ring-4 ring-[#dc2626]/15"
    : done
    ? "bg-[#178a5c] text-white ring-4 ring-[#178a5c]/15"
    : inProgress
    ? "bg-[#ef9f27] text-white ring-4 ring-[#ef9f27]/15"
    : "bg-[#e3eeff] text-[#6b93c4]";
  const labelCls = failed
    ? "text-red-700 font-semibold"
    : done || inProgress
    ? "text-[#0f3d2e] font-semibold"
    : (mutedIfPending ? "text-[#5a8a76] font-medium" : "text-[#0f3d2e] font-semibold");
  const subCls = failed ? "text-red-700" : done || inProgress ? "text-[#5a8a76]" : "text-[#8ab3a1]";
  return (
    <div className="flex-1 flex flex-col items-center gap-3 min-w-0">
      <div className={["w-[56px] h-[56px] rounded-full grid place-items-center shrink-0 transition-all", bg].join(" ")} style={{ transform: "scale(1.35)" }}>
        <span style={{ transform: "scale(1.5)" }}>{icon}</span>
      </div>
      <div className="text-center min-w-0">
        <div className={["text-[15px] leading-tight", labelCls].join(" ")}>{label}</div>
        {sub && <div className={["text-[12px] mt-1", subCls].join(" ")}>{sub}</div>}
      </div>
    </div>
  );
}

export function BigConnector({ active }: { active: boolean }) {
  return (
    <div
      className={["flex-none h-[4px] rounded-full", active ? "bg-[#9dcbe8]" : "bg-[#e3eeff]"].join(" ")}
      style={{ width: "clamp(40px, 8vw, 120px)" }}
    />
  );
}

export function SectionCard({
  title, icon, children, accent, tint, adminOnly,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  accent?: "blue" | "green";
  tint?: boolean;
  adminOnly?: boolean;
}) {
  const borderCls =
    accent === "blue" ? "border-[#d3e9f7]" :
    accent === "green" ? "border-[#cdeadd]" :
    "border-[#cdeadd]";
  const bgCls = tint ? "bg-[#f0faf5]" : "bg-white";
  const titleCls = accent === "blue" ? "text-[#185fa5]" : "text-[#178a5c]";
  return (
    <div className={["rounded-[12px] border p-5", borderCls, bgCls].join(" ")}>
      <div className={["text-[14px] font-semibold mb-3 flex items-center gap-2", titleCls].join(" ")}>
        <span style={{ transform: "scale(1.2)", transformOrigin: "left center", display: "inline-flex" }}>{icon}</span>
        <span>{title}</span>
        {adminOnly && <span className="ml-1.5 text-[11px] text-[#8ab3a1] font-normal">admin</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function KV({ k, v, valueClass }: { k: string; v: unknown; valueClass?: string }) {
  const display = v === null || v === undefined || v === "" ? "—" : String(v);
  return (
    <div className="flex justify-between text-[14px] py-[5px] gap-3">
      <span className="text-[#5a8a76] shrink-0">{k}</span>
      <span className={["text-right min-w-0 truncate font-medium", valueClass ?? "text-[#0f3d2e]"].join(" ")}>{display}</span>
    </div>
  );
}

export function StepBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] font-semibold text-[#5a8a76] uppercase tracking-wider mb-2 pb-1.5 border-b border-[#cdeadd]">
        {title}
      </div>
      {children}
    </div>
  );
}

// ── Document grid ───────────────────────────────────────────────────
//
// One slot per EXPECTED document. `onView` set → uploaded (eye button);
// `onView` undefined → greyed "Not uploaded". Kept source-agnostic so the
// EPC page (doc rows) and the Loan page (doc rows OR *_path columns) can
// both feed it.
export type ViewDocSlot = {
  key: string;
  label: string;
  title?: string;          // tooltip — usually the file name
  onView?: () => void;     // undefined = not uploaded
};

export function DocGrid({
  slots, eyeIcon,
}: {
  slots: ViewDocSlot[];
  eyeIcon: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {slots.map((s) => (
        s.onView ? (
          <button
            key={s.key}
            type="button"
            onClick={s.onView}
            className="border border-[#e0f0e8] bg-[#f7fcfa] hover:bg-[#f0faf5] rounded-[8px] px-3 py-2.5 text-[13px] flex items-center justify-between gap-2 min-w-0"
            title={s.title}
          >
            <span className="text-[#0f3d2e] font-medium truncate">{s.label}</span>
            <span className="text-[#185fa5] shrink-0" style={{ transform: "scale(1.2)" }}>{eyeIcon}</span>
          </button>
        ) : (
          <div
            key={s.key}
            className="border border-dashed border-[#dfe4e2] bg-[#f6f7f7] rounded-[8px] px-3 py-2.5 text-[13px] flex items-center justify-between gap-2 min-w-0"
            title="Not uploaded"
          >
            <span className="text-[#9aa5a0] font-medium truncate">{s.label}</span>
            <span className="text-[#aeb8b3] text-[11px] shrink-0 whitespace-nowrap">Not uploaded</span>
          </div>
        )
      ))}
    </div>
  );
}
