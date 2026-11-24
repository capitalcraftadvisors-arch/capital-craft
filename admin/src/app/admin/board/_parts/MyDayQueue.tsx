"use client";

// Task Manager — "My Day": the ranked Act-today list, with the WhatsApp composer, follow-up, comment and activity pop-ups.

import { useCallback, useEffect, useId, useState } from "react";
import DateField from "@/components/ui/DateField";
import Modal, { OVERLAY, BACKDROP } from "@/components/ui/Modal";
import LoanActivityLogModal from "@/components/LoanActivityLogModal";
import ActivityLogModal from "@/components/ActivityLogModal";
import { columnsFor, type OpsCase, type CaseSource } from "@/lib/ops-board";
import { waTel, waUrl, WA_LANGS, type WaLang } from "@/lib/wa-link";
import { fmtRupees } from "@/lib/money";
import { COMMENT_TBL, attention, loanOutline, OUTLINE_FILL, IDLE_TEXT, isClosedLoan, nextAction, WAIT_COLOR, waitingOn, type WaitParty } from "./rules";
import { WA_PENDING, WA_INTENTS, WA_INTENTS_EPC, waPendingFor, buildWaMessage, type WaIntent } from "./whatsapp";
import { tmState, saveTm } from "./tm-state";

// "My Day" — a ranked to-do list of the user's cases, split into Loan / Leads /
// Insurance / EPC tabs. For a manager it can span the whole team (owner control).
// Each row shows the next action, how long it's waited, the amount, quick-call
// buttons, and a comment count. Default screen for RMs / managers.
const MYDAY_SRC_TABS: { key: CaseSource; label: string }[] = [
  { key: "loan", label: "Loan" },
  { key: "lead", label: "Leads" },
  { key: "insurance", label: "Solar Insurance" },
  { key: "epc", label: "EPC" },
];

// Brand WhatsApp glyph — replaces the old "WA" text on the quick-action button.
// Uses currentColor so the parent's text colour (WhatsApp green) drives it.
function WhatsAppIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.297-.497.1-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.414-.074-.124-.272-.198-.57-.347M12.05 21.785h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
    </svg>
  );
}

export default function MyDayQueue({ items, onOpen, q, onSearch, showOwner, ownerControl, defaultSrc, rmName, todayStr, onStampContact, onSetFollowUp, onAddNote, onDetectDocs }: {
  items: OpsCase[]; onOpen: (href: string) => void; q: string; onSearch: (v: string) => void;
  showOwner: boolean; ownerControl?: React.ReactNode; defaultSrc: CaseSource; rmName: string;
  todayStr: string;
  onStampContact: (c: OpsCase) => void;
  onSetFollowUp: (c: OpsCase, date: string | null) => void;
  onAddNote: (c: OpsCase, text: string) => void;
  onDetectDocs: (c: OpsCase) => Promise<{ have: string[]; need: string[] }>;
}) {
  const [src, setSrc] = useState<CaseSource>(() => tmState().src ?? defaultSrc);
  const [stage, setStage] = useState<string>(() => tmState().stage ?? "all"); // stage sub-tab within the source
  const [colour, setColour] = useState<"all" | "red" | "yellow" | "green">(() => tmState().colour ?? "all");
  useEffect(() => { saveTm({ src, stage, colour }); }, [src, stage, colour]);
  // The case opened last (back from its page): scrolled to and blinking for a moment.
  const [blink, setBlink] = useState<string | null>(() => tmState().last ?? null);
  useEffect(() => {
    if (!blink) return;
    document.getElementById(`myday-${blink}`)?.scrollIntoView({ block: "center" });
    const t = setTimeout(() => { setBlink(null); saveTm({ last: undefined }); }, 2600);
    return () => clearTimeout(t);
  }, [blink]);
  // WhatsApp composer state.
  const [waCase, setWaCase] = useState<OpsCase | null>(null);
  const [waIntent, setWaIntent] = useState<WaIntent>("docs");
  const [waLang, setWaLang] = useState<WaLang>("hi");
  const [waSel, setWaSel] = useState<Set<string>>(new Set());   // docs to REQUEST (go in the message)
  const [waHave, setWaHave] = useState<Set<string>>(new Set()); // docs already on file
  const [waTo, setWaTo] = useState("");
  const [waMsg, setWaMsg] = useState("");
  const [detecting, setDetecting] = useState(false);
  // Follow-up ("Remind") + inline Note modals.
  const [remindCase, setRemindCase] = useState<OpsCase | null>(null);
  const [remindDate, setRemindDate] = useState("");
  const [noteCase, setNoteCase] = useState<OpsCase | null>(null);
  const [noteText, setNoteText] = useState("");
  const [logCase, setLogCase] = useState<OpsCase | null>(null); // activity-log modal
  // The pop-ups’ names for screen readers.
  const waTitleId = useId();
  const remindTitleId = useId();
  const noteTitleId = useId();

  // Check the case's documents (loan only) → split into on-file vs missing; the
  // missing ones are pre-ticked to request. On-demand only: runs once when the
  // composer opens, never polls.
  const runDetect = useCallback(async (c: OpsCase) => {
    setDetecting(true);
    try {
      const { have, need } = await onDetectDocs(c);
      setWaHave(new Set(have));
      setWaSel(new Set(need));
    } finally { setDetecting(false); }
  }, [onDetectDocs]);
  const openWa = (c: OpsCase) => {
    setWaCase(c); setWaIntent("docs"); setWaLang("hi"); setWaTo(waTel(c.mobile));
    setWaSel(new Set()); setWaHave(new Set());
    if (c.source === "loan") void runDetect(c);
  };
  const toggleItem = (key: string) => setWaSel((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  // Rebuild the message whenever the case, intent, language, or selection changes.
  useEffect(() => {
    if (!waCase) return;
    setWaMsg(buildWaMessage(waCase.name, rmName, Array.from(waSel), waCase.source, waIntent, waLang, waCase.epcName));
  }, [waCase, waSel, waIntent, waLang, rmName]);
  const sendWa = () => {
    const ten = waTel(waTo);
    if (!ten || !waCase) return;
    window.open(waUrl(ten, waMsg), "_blank", "noopener,noreferrer");
    onStampContact(waCase); // sending counts as a contact
    setWaCase(null);
  };
  const counts: Record<CaseSource, number> = { loan: 0, lead: 0, insurance: 0, epc: 0 };
  for (const c of items) counts[c.source]++;
  // A closed loan (rejected / 2nd Phase) has no TAT here — pale fill, never "urgent".
  const lvlOf = (c: OpsCase) => (isClosedLoan(c) ? "neutral" : c.source === "loan" ? loanOutline(c) : attention(c, 1));
  const ql = q.trim().toLowerCase();
  const inSrc = items.filter((c) => c.source === src);
  // Stage sub-tabs — the board columns for this source that actually have cases
  // needing action, each with a live count. Lets the day be worked stage by
  // stage (e.g. "Docs Pending", "1st Phase" = 1st tranche done / 2nd due,
  // "2nd Phase" = fully disbursed).
  const stageCounts = new Map<string, number>();
  for (const c of inSrc) if (c.column) stageCounts.set(c.column, (stageCounts.get(c.column) ?? 0) + 1);
  const presentStages = columnsFor(src).filter((s) => (stageCounts.get(s.key) ?? 0) > 0);
  const activeStage = presentStages.some((s) => s.key === stage) ? stage : "all"; // stale-guard on source switch
  const byStage = activeStage === "all" ? inSrc : inSrc.filter((c) => c.column === activeStage);
  const byColour = colour === "all" ? byStage : byStage.filter((c) => lvlOf(c) === colour);
  const shown = ql ? byColour.filter((c) => `${c.name} ${c.lender ?? ""} ${c.epcName ?? ""} ${c.ownerName ?? ""}`.toLowerCase().includes(ql)) : byColour;
  const urgent = shown.filter((c) => lvlOf(c) === "red").length;
  // Rank the day: idle days × loan value → biggest exposure first, work top-down;
  // closed loans (rejected / 2nd Phase) last (shown, but not counted as work below).
  const rankVal = (c: OpsCase) => Math.max(1, Math.floor(c.stageHours / 24)) * (c.amount || 1);
  const ranked = [...shown].sort((a, b) => Number(isClosedLoan(a)) - Number(isClosedLoan(b)) || rankVal(b) - rankVal(a));
  const work = shown.filter((c) => !isClosedLoan(c));
  const custCases = work.filter((c) => waitingOn(c) === "Customer");
  const blocked = work.filter((c) => Math.floor(c.stageHours / 24) >= 2).reduce((s, c) => s + (c.amount || 0), 0);
  const recoverable = custCases.reduce((s, c) => s + (c.amount || 0), 0);
  const delayCats: WaitParty[] = ["Customer", "Lender", "EPC", "Internal"];
  const delayCounts = delayCats.map((k) => ({ k, n: work.filter((c) => waitingOn(c) === k).length }));
  const delayMax = Math.max(1, ...delayCounts.map((d) => d.n));
  const todayLabel = (() => { try { return new Date(todayStr + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" }).toUpperCase(); } catch { return ""; } })();
  // WhatsApp composer uses an EPC-specific doc list + intents when the open case
  // is a partner (source === "epc"); loan/lead/insurance keep the applicant set.
  const waPending = waCase ? waPendingFor(waCase.source) : WA_PENDING;
  const waIntents = waCase?.source === "epc" ? WA_INTENTS_EPC : WA_INTENTS;
  return (
    <div>
      <div className="mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{todayLabel} · one ranked list, work top-down</p>
        <div className="flex items-center gap-3 flex-wrap mt-1">
          <h2 className="text-[22px] font-display font-bold text-text">Act today</h2>
          <span className="text-[13px] text-text-muted">· {work.length} to action{urgent > 0 ? ` · ${urgent} urgent` : ""}</span>
          <div className="ml-auto flex items-center gap-2">
            {ownerControl}
            <select value={colour} onChange={(e) => setColour(e.target.value as "all" | "red" | "yellow" | "green")}
              className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-medium text-text outline-none focus:border-teal-700 cursor-pointer">
              <option value="all">All colours</option>
              <option value="red">🔴 Red</option>
              <option value="yellow">🟡 Yellow</option>
              <option value="green">🟢 Green</option>
            </select>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Search my cases…"
                className="w-40 sm:w-52 border-2 border-line rounded-lg pl-9 pr-3 py-1.5 text-[13px] outline-none focus:border-teal-700" />
            </div>
          </div>
        </div>
      </div>
      {/* Source tabs — Loan / Leads / Insurance / EPC, each with a live count. */}
      <div className="inline-flex border border-line rounded-lg overflow-hidden mb-3">
        {MYDAY_SRC_TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => { setSrc(t.key); setStage("all"); }}
            className={["px-3.5 py-1.5 text-[12px] font-semibold border-r border-line last:border-r-0 inline-flex items-center gap-1.5", src === t.key ? "bg-teal-700 text-white" : "text-text-mid bg-white hover:bg-bg-tint"].join(" ")}>
            {t.label}
            <span className={["text-[10.5px] font-bold px-1.5 rounded-full", src === t.key ? "bg-white/20 text-white" : "bg-grey-pill text-slate-700"].join(" ")}>{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {/* Stage sub-tabs — work the day one stage at a time (Docs Pending, 1st
          Phase = 1st tranche done / 2nd due, etc.). Only stages that have cases
          show up; the count is live. */}
      {presentStages.length >= 2 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          <button type="button" onClick={() => setStage("all")}
            className={["px-2.5 py-1 rounded-full text-[11.5px] font-semibold border inline-flex items-center gap-1.5", activeStage === "all" ? "bg-teal-700 text-white border-teal-700" : "bg-white text-text-mid border-line hover:bg-bg-tint"].join(" ")}>
            All <span className={["text-[10px] font-bold px-1.5 rounded-full", activeStage === "all" ? "bg-white/20" : "bg-grey-pill text-slate-700"].join(" ")}>{inSrc.length}</span>
          </button>
          {presentStages.map((s) => {
            const on = activeStage === s.key;
            return (
              <button key={s.key} type="button" onClick={() => setStage(s.key)}
                className={["px-2.5 py-1 rounded-full text-[11.5px] font-semibold border inline-flex items-center gap-1.5", on ? "bg-teal-700 text-white border-teal-700" : "bg-white text-text-mid border-line hover:bg-bg-tint"].join(" ")}>
                {s.label} <span className={["text-[10px] font-bold px-1.5 rounded-full", on ? "bg-white/20" : "bg-grey-pill text-slate-700"].join(" ")}>{stageCounts.get(s.key)}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="lg:flex lg:gap-5 items-start">
        {/* Ranked worklist — # · case · waiting on · idle · do this now · owner */}
        <div className="flex-1 min-w-0">
          {shown.length === 0 ? (
            <div className="text-[13px] text-text-muted border border-dashed border-line rounded-lg p-10 text-center">
              Nothing in {MYDAY_SRC_TABS.find((t) => t.key === src)?.label} needs action right now. 🎉
            </div>
          ) : (
            <div className="rounded-xl border bg-white overflow-x-auto cc-table-card">
              <table className="w-full text-[13px] cc-table">
                <thead>
                  <tr>
                    <th className="text-left font-medium px-2.5 py-2 w-7">#</th>
                    <th className="text-left font-medium px-2.5 py-2">Case</th>
                    <th className="text-left font-medium px-2.5 py-2">Waiting on</th>
                    <th className="text-left font-medium px-2.5 py-2">Idle</th>
                    <th className="text-left font-medium px-2.5 py-2">Do this now</th>
                    {showOwner && <th className="text-left font-medium px-2.5 py-2">Owner</th>}
                    <th className="px-2.5 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((c, i) => {
                    const act = nextAction(c)!;
                    const days = Math.max(0, Math.floor(c.stageHours / 24));
                    const w = waitingOn(c);
                    const tel = waTel(c.mobile);
                    const hasNote = !!COMMENT_TBL[c.source];
                    const fuDue = !!c.followUpAt && c.followUpAt <= todayStr;
                    return (
                      <tr key={c.source + c.id} id={`myday-${c.source}:${c.id}`}
                        className={["border-b border-cc-row-line-soft last:border-0 hover:bg-cc-row-hover cursor-pointer", blink === `${c.source}:${c.id}` ? "animate-pulse !bg-[#cdeee4]" : ""].join(" ")}
                        onClick={() => { saveTm({ last: `${c.source}:${c.id}` }); onOpen(c.href); }}>
                        <td className="px-2.5 py-2.5 align-top text-text-muted font-semibold">{i + 1}</td>
                        <td className="px-2.5 py-2.5 align-top">
                          <div className="font-semibold text-text truncate max-w-[190px] flex items-center gap-1.5">
                            {c.name}{fuDue && <span title="Follow-up due" className="text-[10px]">⏰</span>}
                          </div>
                          <div className="text-[11px] text-text-muted truncate max-w-[190px]">{c.lender ? `${c.lender} · ` : ""}{c.epcName ?? c.statusLabel}{c.amount > 0 ? ` · ${fmtRupees(c.amount)}` : ""}</div>
                        </td>
                        <td className="px-2.5 py-2.5 align-top whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold" style={{ color: WAIT_COLOR[w] }}>
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: WAIT_COLOR[w] }} />{w}
                          </span>
                        </td>
                        {/* Days in the CURRENT stage, coloured by the board's TAT for that stage. */}
                        <td className="px-2.5 py-2.5 align-top whitespace-nowrap">
                          <span className="inline-block text-[12px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: OUTLINE_FILL[lvlOf(c)], color: IDLE_TEXT[lvlOf(c)] }}>{days}d</span>
                        </td>
                        <td className="px-2.5 py-2.5 align-top text-text-mid">
                          <span className="block truncate max-w-[230px]" title={act.text} style={act.tone ? { color: act.tone, fontWeight: 600 } : undefined}>{act.text}</span>
                        </td>
                        {showOwner && <td className="px-2.5 py-2.5 align-top whitespace-nowrap">{c.ownerName ? <span className="text-text-mid">{c.ownerName}</span> : <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-warn-tint text-warn-ink">Unassigned</span>}</td>}
                        <td className="px-2.5 py-2.5 align-top whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                          <span className="inline-flex items-center gap-2 text-[13px]">
                            {tel && <button type="button" title="WhatsApp" aria-label="WhatsApp" onClick={() => openWa(c)} className="text-[#25D366] hover:opacity-70 inline-flex align-middle"><WhatsAppIcon size={18} /></button>}
                            <button type="button" title="Remind" aria-label="Remind" onClick={() => { setRemindCase(c); setRemindDate(c.followUpAt || ""); }} className="hover:opacity-70">⏰</button>
                            {hasNote && <button type="button" title="Comment" aria-label="Comment" onClick={() => { setNoteCase(c); setNoteText(""); }} className="hover:opacity-70">✎</button>}
                            {(c.source === "loan" || c.source === "epc") && <button type="button" title="Activity" aria-label="Activity" onClick={() => setLogCase(c)} className="hover:opacity-70">🕘</button>}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Today's math + Who is delaying */}
        <aside className="lg:w-72 shrink-0 mt-4 lg:mt-0 space-y-4">
          <div className="rounded-lg border border-danger-line bg-[#fdf0f0] p-4">
            <p className="text-[12px] font-bold uppercase tracking-wide text-danger-ink mb-2">Today&rsquo;s math</p>
            <div className="flex justify-between items-baseline text-[13px] py-1 border-b border-danger-line/60"><span className="text-[#8a3a3a]">₹ blocked (stuck &gt; 2d)</span><span className="font-bold text-danger-ink">{fmtRupees(blocked)}</span></div>
            <div className="flex justify-between items-baseline text-[13px] py-1 border-b border-danger-line/60"><span className="text-[#8a3a3a]">Recoverable by {custCases.length} call{custCases.length === 1 ? "" : "s"}</span><span className="font-bold text-danger-ink">{fmtRupees(recoverable)}</span></div>
            <div className="flex justify-between items-baseline text-[13px] py-1"><span className="text-[#8a3a3a]">Cases to action</span><span className="font-bold text-danger-ink">{work.length}</span></div>
          </div>
          <div className="rounded-lg border border-line bg-white p-4">
            <p className="text-[12px] font-bold uppercase tracking-wide text-text-mid mb-3">Who is delaying</p>
            {delayCounts.map((d) => (
              <div key={d.k} className="mb-2.5 last:mb-0">
                <div className="flex justify-between text-[12px] mb-1"><span className="text-text">{d.k}</span><span className="font-semibold text-text">{d.n} case{d.n === 1 ? "" : "s"}</span></div>
                <div className="h-2 rounded-full bg-grey-line overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(d.n / delayMax) * 100}%`, backgroundColor: WAIT_COLOR[d.k] }} /></div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* WhatsApp composer — pick pending items → Hindi message → open WhatsApp. */}
      {waCase && (
        <Modal onClose={() => setWaCase(null)} overlayClassName={OVERLAY.layered} backdropClassName={BACKDROP} className="relative w-full max-w-md bg-white rounded-card-lg shadow-lg p-5 max-h-[90vh] overflow-y-auto" aria-labelledby={waTitleId}>
          <div className="flex items-start justify-between gap-2 mb-3">
            <div>
              <div id={waTitleId} className="text-[15px] font-bold text-text">Send WhatsApp</div>
              <div className="text-[12px] text-text-muted">{waCase.name}</div>
            </div>
            <button type="button" onClick={() => setWaCase(null)} aria-label="Close" className="text-[18px] text-text-muted hover:text-text leading-none p-1">✕</button>
          </div>

          {/* Message intent */}
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-mid mb-1.5">Message</div>
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {waIntents.map((t) => (
              <button key={t.key} type="button" onClick={() => setWaIntent(t.key)}
                className={["text-[12px] rounded-lg border px-2.5 py-1.5 transition-colors", waIntent === t.key ? "border-teal-700 bg-teal-700 text-white font-semibold" : "border-line bg-white text-text-mid hover:bg-bg-tint"].join(" ")}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Message language (message text only) */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-text-mid">Language</span>
            <div className="inline-flex border border-line rounded-lg overflow-hidden">
              {WA_LANGS.map((l) => (
                <button key={l.key} type="button" onClick={() => setWaLang(l.key)}
                  className={["px-2.5 py-1 text-[12px] font-semibold border-r border-line last:border-r-0", waLang === l.key ? "bg-teal-700 text-white" : "text-text-mid bg-white hover:bg-bg-tint"].join(" ")}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {/* Documents — on-file vs still-needed (loan cases are auto-checked) */}
          {waIntent === "docs" && (
            <>
              {waHave.size > 0 && (
                <div className="mb-2.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-text-mid mb-1">Docs received ({waHave.size})</div>
                  <div className="flex flex-wrap gap-1.5">
                    {waPending.filter((it) => waHave.has(it.key)).map((it) => (
                      <span key={it.key} className="text-[11.5px] rounded-lg border border-[#bfe6d3] bg-[#eefaf3] text-[#0f6b4b] px-2 py-1 inline-flex items-center gap-1">✓ {it.label}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-text-mid">Request{waCase.source === "loan" ? " · missing pre-ticked" : ""}</span>
                {waCase.source === "loan" && (
                  <button type="button" onClick={() => void runDetect(waCase)} disabled={detecting}
                    className="text-[11px] font-semibold text-cc-blue hover:underline disabled:opacity-50">
                    {detecting ? "Checking…" : "Re-check"}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-1.5 mb-3">
                {waPending.filter((it) => !waHave.has(it.key)).map((it) => {
                  const on = waSel.has(it.key);
                  return (
                    <button key={it.key} type="button" onClick={() => toggleItem(it.key)}
                      className={["text-left text-[12px] rounded-lg border px-2.5 py-1.5 transition-colors", on ? "border-teal-700 bg-[#dcf3ef] text-cc-ink font-semibold" : "border-line bg-white text-text-mid hover:bg-bg-tint"].join(" ")}>
                      {on ? "✓ " : ""}{it.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-mid">Send to</div>
          <div className="flex items-center gap-2 mt-1 mb-3">
            <span className="text-[13px] text-text-muted">+91</span>
            <input aria-label="Send to" value={waTo} onChange={(e) => setWaTo(e.target.value)} inputMode="numeric" placeholder="10-digit number"
              className="flex-1 border border-line rounded-lg px-3 py-2 text-[13px] outline-none focus:border-teal-700" />
          </div>

          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-mid">Message preview</div>
          <textarea aria-label="Message preview" value={waMsg} onChange={(e) => setWaMsg(e.target.value)} rows={9}
            className="w-full mt-1 border border-line rounded-lg px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-teal-700 resize-none" />

          <div className="flex items-center justify-between gap-2 mt-3">
            <span className="text-[11px] text-text-muted">Sent from your WhatsApp</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setWaCase(null)} className="text-[12px] font-semibold px-3.5 py-2 rounded-lg border border-line text-text-mid hover:bg-bg-tint">Cancel</button>
              <button type="button" onClick={sendWa} disabled={!waTel(waTo)}
                className="text-[12px] font-semibold px-4 py-2 rounded-lg bg-whatsapp text-white hover:bg-teal-700 disabled:opacity-50 inline-flex items-center gap-1.5">
                Send on WhatsApp →
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Follow-up ("Remind me") — set / change / clear a call-back date. */}
      {remindCase && (
        <Modal onClose={() => setRemindCase(null)} overlayClassName={OVERLAY.layered} backdropClassName={BACKDROP} className="relative w-full max-w-sm bg-white rounded-card-lg shadow-lg p-5" aria-labelledby={remindTitleId}>
          <div className="flex items-start justify-between gap-2 mb-3">
            <div>
              <div id={remindTitleId} className="text-[15px] font-bold text-text">Follow-up date</div>
              <div className="text-[12px] text-text-muted">{remindCase.name}</div>
            </div>
            <button type="button" onClick={() => setRemindCase(null)} aria-label="Close" className="text-[18px] text-text-muted hover:text-text leading-none p-1">✕</button>
          </div>
          <DateField value={remindDate} onChange={setRemindDate} min={todayStr}
            className="border border-line rounded-lg px-3 py-2 text-[14px] outline-none focus:border-teal-700" />
          <div className="flex items-center justify-between gap-2 mt-4">
            {remindCase.followUpAt
              ? <button type="button" onClick={() => { onSetFollowUp(remindCase, null); setRemindCase(null); }} className="text-[12px] font-semibold text-danger-ink hover:underline">Remove</button>
              : <span />}
            <div className="flex gap-2">
              <button type="button" onClick={() => setRemindCase(null)} className="text-[12px] font-semibold px-3.5 py-2 rounded-lg border border-line text-text-mid hover:bg-bg-tint">Cancel</button>
              <button type="button" onClick={() => { onSetFollowUp(remindCase, remindDate || null); setRemindCase(null); }} disabled={!remindDate}
                className="text-[12px] font-semibold px-4 py-2 rounded-lg bg-teal-700 text-white hover:bg-[#0c5f58] disabled:opacity-50">Set</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Inline note — a comment on the case (visible to everyone). */}
      {noteCase && (
        <Modal onClose={() => setNoteCase(null)} overlayClassName={OVERLAY.layered} backdropClassName={BACKDROP} className="relative w-full max-w-sm bg-white rounded-card-lg shadow-lg p-5" aria-labelledby={noteTitleId}>
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <div id={noteTitleId} className="text-[15px] font-bold text-text">Add comment</div>
              <div className="text-[12px] text-text-muted">{noteCase.name} · visible to everyone</div>
            </div>
            <button type="button" onClick={() => setNoteCase(null)} aria-label="Close" className="text-[18px] text-text-muted hover:text-text leading-none p-1">✕</button>
          </div>
          <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={4} autoFocus placeholder="Write a comment…"
            className="w-full border border-line rounded-lg px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-teal-700 resize-none" />
          <div className="flex justify-end gap-2 mt-3">
            <button type="button" onClick={() => setNoteCase(null)} className="text-[12px] font-semibold px-3.5 py-2 rounded-lg border border-line text-text-mid hover:bg-bg-tint">Cancel</button>
            <button type="button" onClick={() => { onAddNote(noteCase, noteText); setNoteCase(null); }} disabled={!noteText.trim()}
              className="text-[12px] font-semibold px-4 py-2 rounded-lg bg-teal-700 text-white hover:bg-[#0c5f58] disabled:opacity-50">Add</button>
          </div>
        </Modal>
      )}

      {/* Activity log — the case's audit trail (loan / EPC). */}
      {logCase && logCase.source === "loan" && (
        <LoanActivityLogModal open onClose={() => setLogCase(null)} loan={{ id: logCase.id, borrower_name: logCase.name }} borrowerName={logCase.name} />
      )}
      {logCase && logCase.source === "epc" && (
        <ActivityLogModal open onClose={() => setLogCase(null)} businessId={logCase.id} epcName={logCase.name} />
      )}
    </div>
  );
}
