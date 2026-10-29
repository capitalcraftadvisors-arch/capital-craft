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

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getBusiness } from "@/lib/auth";

// Layout effect in the browser (measure before paint), plain effect on the server.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

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
  briefcase: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M2 13h20"/></svg>),
  files: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15h6M9 11h4"/></svg>),
  star: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 15.09 8.26 22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>),
  lock: (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>),
  money: (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/></svg>),
  invoice: (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2h9l5 5v15H6z"/><path d="M15 2v6h5M9 12h6M9 16h6M9 8h3"/></svg>),
  check: (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7"/></svg>),
  send: (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>),
  circleCheck: (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>),
  eye: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 12s3.5-7 10.5-7 10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>),
  trash: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>),
  edit: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3l4 4-13 13H4v-4z"/></svg>),
  download: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16"/></svg>),
  id: (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="9" cy="12" r="2"/><path d="M14 10h5M14 14h5"/></svg>),
  copy: (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>),
  checkCircle: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>),
  xCircle: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>),
  alertCircle: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>),
  minusCircle: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>),
  external: (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3h7v7M21 3l-9 9"/><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg>),
  close: (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>),
  chevLeft: (<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>),
  chevRight: (<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>),
  activity: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>),
};

// ── Copy-to-clipboard ───────────────────────────────────────────────
// Copies the RAW value (e.g. the full account number behind a masked one) and
// shows a brief tick.
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    } catch { /* clipboard blocked — nothing to do */ }
  }
  return (
    <button
      type="button"
      onClick={copy}
      title={label}
      aria-label={label}
      className={["inline-flex shrink-0 align-middle transition-colors", done ? "text-[#178a5c]" : "text-[#8ab3a1] hover:text-[#185fa5]"].join(" ")}
    >
      {done ? I.check : I.copy}
    </button>
  );
}

// ── KPI tile (accent bar + label + value + optional sub-line) ────────
export function KpiTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 shadow-sm min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-1 h-3 rounded-full shrink-0" style={{ backgroundColor: accent }} />
        <span className="text-[10px] font-medium text-text-muted uppercase tracking-wide truncate">{label}</span>
      </div>
      <div className="text-[17px] font-display font-bold text-text mt-1 leading-none truncate">{value}</div>
      {sub && <div className="text-[10px] text-text-muted mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

// ── Progress bar that IS the tabs ───────────────────────────────────
// The familiar stage circles (done green, in progress amber, failed red, not
// reached pale blue). Click a stage to open it; the open stage gets a ring and
// an underline.
export type StageState = "done" | "current" | "failed" | "hold" | "pending";
export function ProgressTabs({
  items, value, onChange,
}: {
  items: Array<{ key: string; label: string; sub?: React.ReactNode; icon: React.ReactNode; state: StageState }>;
  value: string;
  onChange: (key: string) => void;
}) {
  const circle: Record<StageState, string> = {
    done: "bg-[#178a5c] text-white",
    current: "bg-[#ef9f27] text-white",
    failed: "bg-[#dc2626] text-white",
    hold: "bg-[#f3c969] text-[#6b4a00]",
    pending: "bg-[#e3eeff] text-[#6b93c4]",
  };
  // Padding so the open stage's ring isn't clipped by the scroll box.
  return (
    <div className="overflow-x-auto pt-2.5 pb-1">
      <div role="tablist" className="flex items-start min-w-[640px]">
        {items.map((it, i) => {
          const active = it.key === value;
          return (
            <React.Fragment key={it.key}>
              {i > 0 && (
                <div className={["flex-1 h-[3px] rounded-full mt-[27px] min-w-[20px]", items[i - 1].state === "done" ? "bg-[#9dcbe8]" : "bg-[#e3eeff]"].join(" ")} />
              )}
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onChange(it.key)}
                className="group w-[128px] shrink-0 flex flex-col items-center gap-2 outline-none"
              >
                <span className={[
                  "w-[56px] h-[56px] rounded-full grid place-items-center transition-shadow [&>svg]:w-[22px] [&>svg]:h-[22px]",
                  circle[it.state],
                  active ? "ring-4 ring-offset-2 ring-[#178a5c]/30" : "group-hover:ring-4 group-hover:ring-[#178a5c]/10",
                ].join(" ")}>
                  {it.icon}
                </span>
                <span className={["text-[14px] leading-tight text-center", it.state === "failed" ? "font-semibold text-red-700" : it.state === "pending" && !active ? "font-medium text-[#5a8a76]" : "font-semibold text-[#0f3d2e]"].join(" ")}>
                  {it.label}
                </span>
                {it.sub && (
                  <span className={["-mt-1 text-[12px] text-center leading-tight", it.state === "failed" ? "text-red-700" : it.state === "pending" ? "text-[#9fb9ae]" : "text-[#5a8a76]"].join(" ")}>
                    {it.sub}
                  </span>
                )}
                <span className={["h-[3px] w-12 rounded-full", active ? "bg-[#178a5c]" : "bg-transparent"].join(" ")} />
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ── Page section — a title row, optional fold ───────────────────────
// `summary` shows beside the title while folded, so a folded section still
// says what's in it. `fold` mounts the body only when opened (a body that
// loads data costs nothing until then). `dropdown` keeps the section a single
// title row; resting the mouse on it drops its details down OVER the page
// (nothing below moves), and moving away closes it — the panel stays inside
// its own column, so it never covers the column beside it. `inline` opens it
// in place instead (pushing down), for the last card of a column, so it never
// covers what's above either. Tapping the title toggles it on touch screens.
// `card` draws it as a bordered card with a green icon + title (the profile's
// original look) instead of a flat row; `white` keeps that card's inside white.
export function Section({
  title, icon, summary, right, fold, dropdown, inline, card, white, children,
}: {
  title: string;
  icon?: React.ReactNode;   // card: shown before the title
  summary?: React.ReactNode;
  right?: React.ReactNode;
  fold?: "open" | "closed"; // set → the title toggles the body
  dropdown?: boolean;
  inline?: boolean;         // dropdown body opens in place, not floating
  card?: boolean;
  white?: boolean;          // card: white inside instead of the green tint
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(fold !== "closed" && !dropdown);
  const openRef = useRef(open);
  openRef.current = open;
  // Dropdown panel: `mounted` = shown (kept through its fade-out); `ever` = its
  // body was built once and is kept, so reopening it reloads nothing.
  const [mounted, setMounted] = useState(false);
  const [ever, setEver] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  // Fit the panel on screen: one that would run past the bottom moves up (not
  // under the sticky page header); one taller than the screen scrolls inside.
  const secRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ shift: number; maxH?: number }>({ shift: 0 });
  // A card's panel opens just under its border; a flat row's tucks under the title.
  const offset = card ? 6 : -10;
  useIsoLayoutEffect(() => {
    if (!dropdown || inline || !mounted || !secRef.current || !panelRef.current) return;
    const fit = () => {
      if (!secRef.current || !panelRef.current) return;
      const gap = 12;
      const hdr = document.querySelector("header");
      const minTop = (hdr && getComputedStyle(hdr).position === "sticky" ? hdr.getBoundingClientRect().bottom : 0) + gap;
      const bottom = window.innerHeight - gap;
      const top0 = secRef.current.getBoundingClientRect().bottom + offset;
      const h = panelRef.current.scrollHeight;
      const maxH = bottom - minTop;
      const fitH = Math.min(h, maxH);
      setPlace({ shift: top0 + fitH > bottom ? Math.max(minTop, bottom - fitH) - top0 : 0, maxH: h > maxH ? maxH : undefined });
    };
    fit();
    // Content that arrives after opening (e.g. the activity list) re-fits it.
    const ro = typeof ResizeObserver !== "undefined" && bodyRef.current ? new ResizeObserver(fit) : null;
    if (ro && bodyRef.current) ro.observe(bodyRef.current);
    return () => ro?.disconnect();
  }, [mounted, dropdown]);
  function drop(on: boolean, delay: number) {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (on) { setEver(true); setMounted(true); requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true))); }
      else if (openRef.current) setOpen(false);
      else setMounted(false);
    }, delay);
  }
  const toggles = !!fold || !!dropdown;
  const titleEl = card ? (
    <span className="flex items-center gap-2 text-[15px] font-semibold text-[#178a5c] shrink-0">
      {icon && <span style={{ transform: "scale(1.2)", transformOrigin: "left center", display: "inline-flex" }}>{icon}</span>}
      {title}
    </span>
  ) : <span className="text-[15px] font-semibold text-[#0f3d2e] shrink-0">{title}</span>;
  const summaryEl = summary && (dropdown || !fold || !open) ? <span className="text-[13px] text-[#7a958a] truncate">{summary}</span> : null;
  // A card points down and sits at the right; a flat row's points right, before the title.
  const chevron = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      className={[
        "shrink-0 transition-transform duration-200",
        card
          ? (open ? "rotate-180 text-[#178a5c]" : "text-[#8ab3a1] group-hover:text-[#178a5c]")
          : open ? (dropdown ? "rotate-90 text-[#178a5c]" : "rotate-90 text-[#8ab3a1]") : "text-[#8ab3a1] group-hover:text-[#0f3d2e]",
      ].join(" ")}>
      <path d={card ? "m6 9 6 6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
  return (
    <section
      ref={secRef}
      className={
        card
          ? ["relative rounded-[12px] border px-5 py-4 transition-colors duration-200",
              dropdown && open ? "border-[#9fd6bd] bg-[#e9f6ef]" : white ? "border-[#cdeadd] bg-white" : "border-[#cdeadd] bg-[#f4fbf7]",
              dropdown ? "hover:border-[#9fd6bd]" : ""].join(" ")
          : ["py-5 border-b border-[#eef3f1] last:border-b-0", dropdown ? "relative" : ""].join(" ")
      }
      // A short rest before opening, so passing over a title doesn't open it.
      onMouseEnter={dropdown ? () => drop(true, 120) : undefined}
      onMouseLeave={dropdown ? () => drop(false, 150) : undefined}
    >
      <div className="flex items-center justify-between gap-3 min-h-[28px]">
        {toggles ? (
          <button
            type="button"
            onClick={() => (dropdown ? drop(!open, 0) : setOpen((v) => !v))}
            aria-expanded={open}
            className={["flex items-center gap-2 min-w-0 text-left group", card ? "flex-1" : ""].join(" ")}
          >
            {!card && chevron}
            {titleEl}
            {summaryEl}
            {card && <span className="ml-auto pl-2 inline-flex">{chevron}</span>}
          </button>
        ) : (
          <div className="flex items-center gap-2 min-w-0">{titleEl}{summaryEl}</div>
        )}
        {right && <div className="shrink-0 flex items-center gap-2">{right}</div>}
      </div>
      {dropdown && inline ? (
        ever && (
          <div
            className={["transition-opacity duration-200 ease-out", mounted ? "" : "hidden", open ? "opacity-100" : "opacity-0"].join(" ")}
            onTransitionEnd={() => { if (!open) setMounted(false); }}
          >
            <div className="mt-4">{children}</div>
          </div>
        )
      ) : dropdown ? (
        ever && (
          <div
            className={[
              "absolute z-20 left-0 right-0 transition-[opacity,transform] duration-200 ease-out",
              mounted ? "" : "hidden",
              open ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1 pointer-events-none",
            ].join(" ")}
            style={{ top: `calc(100% + ${offset}px + ${place.shift}px)` }}
            onTransitionEnd={() => { if (!open) setMounted(false); }}
          >
            <div
              ref={panelRef}
              className="rounded-[12px] border border-[#9fd6bd] bg-[#f4fbf7] p-5 shadow-[0_16px_40px_-12px_rgba(15,61,46,0.25)]"
              style={place.maxH ? { maxHeight: place.maxH, overflowY: "auto" } : undefined}
            >
              <div ref={bodyRef}>{children}</div>
            </div>
          </div>
        )
      ) : open && <div className="mt-4">{children}</div>}
    </section>
  );
}

// ── "filled / total" — red under half, yellow from half, green "100%" ─
export function fillTone(have: number, total: number): string {
  if (total <= 0 || have >= total) return "text-[#178a5c]";
  return have / total < 0.5 ? "text-red-600" : "text-[#d4900f]";
}
export function fillText(have: number, total: number): string {
  return total > 0 && have >= total ? "100%" : `${have}/${total}`;
}
export function FillCount({ have, total }: { have: number; total: number }) {
  return (
    <span className={["text-[12px] font-semibold tabular-nums", fillTone(have, total)].join(" ")}>
      {fillText(have, total)}
    </span>
  );
}

// ── Key numbers — one card each, big values ─────────────────────────
export function StatCards({ items }: { items: Array<{ label: string; value: string; sub?: string; tone?: string }> }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map((s) => (
        <div key={s.label} className="min-w-0 rounded-[12px] border border-[#cdeadd] bg-[#f4fbf7] px-5 py-4 shadow-[0_1px_2px_rgba(15,61,46,0.05)]">
          <div className="text-[12.5px] text-[#5a8a76]">{s.label}</div>
          <div className={["text-[24px] font-semibold leading-tight mt-1 truncate", s.tone ?? "text-[#0f3d2e]"].join(" ")}>{s.value}</div>
          {s.sub && <div className="text-[12px] text-[#7a958a] mt-0.5 truncate">{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ── Checks panel ("9 passed · 1 partial · 1 failed") ─────────────────
// Problems (failed / partial) are always listed; the passed and not-on-file
// rows fold behind "Show all".
export type CheckItem = { key: string; label: string; status: "pass" | "partial" | "fail" | "na"; value?: string };
export function ChecksPanel({ items, extra }: { items: CheckItem[]; extra?: Record<string, React.ReactNode> }) {
  const [all, setAll] = useState(false);
  const n = (s: CheckItem["status"]) => items.filter((i) => i.status === s).length;
  const pass = n("pass"), partial = n("partial"), fail = n("fail");
  const counted = pass + partial + fail;
  const order = { fail: 0, partial: 1, pass: 2, na: 3 } as const;
  const sorted = [...items].sort((a, b) => order[a.status] - order[b.status]);
  const shown = all ? sorted : sorted.filter((i) => i.status === "fail" || i.status === "partial");
  const icon = { pass: I.checkCircle, partial: I.alertCircle, fail: I.xCircle, na: I.minusCircle };
  const iconCls = { pass: "text-[#178a5c]", partial: "text-[#b7791f]", fail: "text-red-600", na: "text-[#b4bdb9]" };
  const valCls = { pass: "text-[#5a8a76]", partial: "text-[#854f0b] bg-[#fef0d6]", fail: "text-red-700 bg-red-50", na: "text-[#9aa5a0]" };
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 rounded-full bg-[#eef3f1] overflow-hidden flex">
          {counted > 0 && <>
            <div className="bg-[#178a5c]" style={{ width: `${(pass / counted) * 100}%` }} />
            <div className="bg-[#ef9f27]" style={{ width: `${(partial / counted) * 100}%` }} />
            <div className="bg-red-500" style={{ width: `${(fail / counted) * 100}%` }} />
          </>}
        </div>
        <span className="shrink-0 text-[12.5px] text-[#7a958a]">
          <span className="text-[#178a5c] font-semibold">{pass} passed</span>
          {partial > 0 && <> · <span className="text-[#854f0b] font-semibold">{partial} partial</span></>}
          {fail > 0 && <> · <span className="text-red-700 font-semibold">{fail} failed</span></>}
        </span>
      </div>
      <ul className="mt-2 divide-y divide-[#f1f5f3]">
        {shown.map((it) => (
          <li key={it.key} className="py-2 text-[13px]">
            <div className="flex items-center gap-2">
              <span className={["inline-flex shrink-0", iconCls[it.status]].join(" ")}>{icon[it.status]}</span>
              <span className={["flex-1 min-w-0 truncate", it.status === "na" ? "text-[#9aa5a0]" : "text-[#0f3d2e] font-medium"].join(" ")}>{it.label}</span>
              {it.value && (
                <span className={["shrink-0 text-[12px] font-semibold rounded-[6px]", it.status === "partial" || it.status === "fail" ? "px-2 py-0.5" : "", valCls[it.status]].join(" ")}>{it.value}</span>
              )}
            </div>
            {extra?.[it.key] && <div className="pl-6 mt-1">{extra[it.key]}</div>}
          </li>
        ))}
      </ul>
      {sorted.length > shown.length || all ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-[12.5px] font-semibold text-[#185fa5] hover:underline">
          {all ? "Show less" : `Show all ${items.length}`}
        </button>
      ) : null}
    </div>
  );
}

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

// GST addresses are stored with field labels ("Floor No.: 251/151, Building
// No./Flat No.: ROOPPURA, …, PIN Code: 333033"). For display we strip the
// labels and keep just the values → "251/151, ROOPPURA, …, 333033".
export function formatGstAddress(raw?: string | null): string {
  if (!raw) return "";
  return raw
    .split(/,\s*/)
    .map((part) => { const i = part.indexOf(":"); return (i >= 0 ? part.slice(i + 1) : part).trim(); })
    .filter(Boolean)
    .join(", ");
}

export function KV({ k, v, valueClass, wrap, copy, mark }: { k: string; v: unknown; valueClass?: string; wrap?: boolean; copy?: string | null; mark?: boolean }) {
  const display = v === null || v === undefined || v === "" ? "—" : String(v);
  // wrap: show the full value across as many rows as needed (e.g. a long address)
  // instead of truncating it. copy: the RAW value to copy (may differ from the
  // shown one, e.g. a masked account number). mark: an empty value is a gap to
  // fill, so its dash shows amber.
  const missing = mark && display === "—";
  return (
    <div className="flex justify-between text-[14px] py-[5px] gap-3">
      <span className="text-[#5a8a76] shrink-0">{k}</span>
      <span className="flex items-center gap-1.5 min-w-0">
        <span className={[wrap ? "text-right min-w-0 break-words font-medium" : "text-right min-w-0 truncate font-medium", missing ? "text-[#d4900f]" : valueClass ?? "text-[#0f3d2e]"].join(" ")}>{display}</span>
        {copy && display !== "—" && <CopyButton value={copy} />}
      </span>
    </div>
  );
}

// ── A titled column of fields with a filled / total count ────────────
// Empty fields show an amber dash; `optional` ones stay grey and don't count.
export type FieldRow = { k: string; v: unknown; copy?: string | null; wrap?: boolean; valueClass?: string; optional?: boolean };
const isBlank = (v: unknown) => v === null || v === undefined || v === "" || v === "—";
/** Filled / total over the rows that count (optional rows don't). */
export function fieldFill(...cols: FieldRow[][]): { have: number; total: number } {
  const counted = cols.flat().filter((r) => !r.optional);
  return { have: counted.filter((r) => !isBlank(r.v)).length, total: counted.length };
}
export function FieldCol({ title, rows, children }: { title: string; rows: FieldRow[]; children?: React.ReactNode }) {
  const fill = fieldFill(rows);
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1.5 pb-1.5 border-b border-[#eef3f1]">
        <span className="text-[12.5px] font-semibold text-[#178a5c] uppercase tracking-wide">{title}</span>
        {fill.total > 0 && <FillCount have={fill.have} total={fill.total} />}
      </div>
      {rows.map((r) => (
        <KV key={r.k} k={r.k} v={r.v} copy={r.copy} wrap={r.wrap} valueClass={r.valueClass} mark={!r.optional} />
      ))}
      {children}
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
  onDownload?: () => void; // set → show a download button beside the eye
  onDelete?: () => void;   // set → show a trash button beside the eye (owner only)
};

// Deleting a document from a View profile is the owner's (Pri) only; an edit
// form (`editable`) leaves it to the caller. Either way it always asks first.
// One place, so every profile follows the same rule.
function deleteHandler(s: ViewDocSlot, editable?: boolean): (() => void) | undefined {
  if (!s.onDelete || (!editable && !getBusiness()?.is_owner)) return undefined;
  return () => { if (window.confirm(`Delete "${s.label}"? This can't be undone.`)) s.onDelete!(); };
}

export function DocGrid({
  slots, eyeIcon, editable,
}: {
  slots: ViewDocSlot[];
  eyeIcon: React.ReactNode;
  editable?: boolean; // an edit form, not a View profile
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {slots.map((s) => (
        s.onView ? (
          <div
            key={s.key}
            className="border border-[#b9e2cc] bg-[#e6f6ee] rounded-[8px] px-3 py-2.5 text-[13px] flex items-center justify-between gap-2 min-w-0"
            title={s.title}
          >
            <button
              type="button"
              onClick={s.onView}
              className="flex-1 min-w-0 text-left text-[#0f3d2e] font-medium truncate hover:text-[#185fa5]"
            >
              {s.label}
            </button>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={s.onView}
                title="View" aria-label="View"
                className="text-[#185fa5] hover:text-[#0f3d2e]"
                style={{ transform: "scale(1.15)" }}
              >
                {eyeIcon}
              </button>
              {s.onDownload && (
                <button
                  type="button"
                  onClick={s.onDownload}
                  title="Download" aria-label="Download"
                  className="text-[#185fa5] hover:text-[#0f3d2e]"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
                </button>
              )}
              {deleteHandler(s, editable) && (
                <button
                  type="button"
                  onClick={deleteHandler(s, editable)}
                  title="Remove document" aria-label="Remove document"
                  className="text-red-600 hover:text-red-700"
                >
                  {I.trash}
                </button>
              )}
            </div>
          </div>
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

// ── Document viewer — a large in-page look at one document, with
// previous / next across the profile's documents (← → keys, Esc closes).
// Reuses URLs the page already signed; `getUrl` signs only a stale one.
export type ViewerItem = {
  key: string;
  label: string;
  at?: string | null;
  pdf?: boolean;
  getUrl: () => Promise<string | null>;
  onOpen?: () => void;      // new tab
  onDownload?: () => void;
};
export function DocViewer({
  items, index, onIndex, onClose,
}: {
  items: ViewerItem[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const it = index != null ? items[index] ?? null : null;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!it) return;
    let live = true;
    setUrl(null); setFailed(false);
    void it.getUrl().then((u) => { if (!live) return; if (u) setUrl(u); else setFailed(true); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [it?.key]);
  useEffect(() => {
    if (index == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
      else if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onClose, onIndex]);
  if (!it || index == null) return null;

  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const btn = "w-10 h-10 rounded-full grid place-items-center text-white/80 hover:text-white hover:bg-white/10 transition-colors";
  const nav = "absolute top-1/2 -translate-y-1/2 w-11 h-11 rounded-full grid place-items-center bg-white/10 text-white hover:bg-white/20 transition-colors";
  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 text-white" onClick={stop}>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold truncate">{it.label}</div>
          <div className="text-[12px] text-white/60 tabular-nums">{index + 1} / {items.length}{it.at ? `  ·  ${it.at}` : ""}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {it.onDownload && <button type="button" onClick={it.onDownload} title="Download" aria-label="Download" className={btn}>{I.download}</button>}
          {it.onOpen && <button type="button" onClick={it.onOpen} title="Open in new tab" aria-label="Open in new tab" className={btn}>{I.external}</button>}
          <button type="button" onClick={onClose} title="Close" aria-label="Close" className={btn}>{I.close}</button>
        </div>
      </div>
      <div className="flex-1 min-h-0 relative flex items-center justify-center px-4 sm:px-16 pb-6">
        {!url ? (
          <p className="text-[14px] text-white/60">{failed ? "Couldn't load" : "Loading…"}</p>
        ) : it.pdf ? (
          <iframe key={url} src={url} title={it.label} onClick={stop} className="w-full h-full max-w-[1100px] bg-white rounded-[6px]" />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img key={url} src={url} alt={it.label} onClick={stop} className="max-w-full max-h-full object-contain rounded-[4px]" style={{ imageOrientation: "from-image" }} />
        )}
        {index > 0 && (
          <button type="button" onClick={(e) => { stop(e); onIndex(index - 1); }} title="Previous" aria-label="Previous" className={[nav, "left-2 sm:left-4"].join(" ")}>{I.chevLeft}</button>
        )}
        {index < items.length - 1 && (
          <button type="button" onClick={(e) => { stop(e); onIndex(index + 1); }} title="Next" aria-label="Next" className={[nav, "right-2 sm:right-4"].join(" ")}>{I.chevRight}</button>
        )}
      </div>
    </div>
  );
}
