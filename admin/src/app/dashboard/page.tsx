"use client";

// EPC PORTAL — the partner cockpit. A navy sidebar shell over five sections:
//   Dashboard (KPI band + unified attention + pipeline + today's activity + RM)
//   Loans (8-column table → per-application timeline drawer)
//   Insurance (the EPC's own policies)
//   EMI calculator (PM Surya Ghar subsidy + live EMI, reusing lib/emi)
//   Documents (download center — first pass)
// All reads are RLS-scoped to the logged-in EPC (own_applications / own_insurance).

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import LoginWelcome from "@/components/LoginWelcome";
import { logout, getBusiness, getToken, greetingName, loanAccess, insuranceAccess } from "@/lib/auth";
import { fetchEpcName, shortEpcName } from "@/lib/epc-name";
import { supabase } from "@/lib/supabase";
import { fmtRupees, fmtDateShort, deadlineState, DEADLINE_PILL } from "@/lib/disbursement";
import { policyValidityParts, VALIDITY_TEXT } from "@/lib/insurance-validity";
import { computeCentralSubsidy, computeEmi, DEFAULT_INDICATIVE_ROI, TENURES, formatRupees } from "@/lib/emi";

// Capital Craft regional managers shown on the EPC portal (tap to Call). Numbers
// are in international format, digits only. TODO: confirm these are the correct
// numbers before deploying to production.
const RMS: { name: string; phone: string }[] = [
  { name: "Manish Kumar", phone: "918769145691" },
  { name: "Malvika",      phone: "917300085864" },
];

const NAVY = "#14235c", NAVY_ACCENT = "#1e3a8a";

type AppRow = {
  id: string;
  borrower_name: string | null; aadhaar_name: string | null; loan_display_id: string | null;
  loan_amount: number | null; loan_amount_required: number | null;
  project_size: number | null; project_size_unit: string | null;
  sanctioned_amount: number | null;
  first_disbursement_amount: number | null; first_disbursement_date: string | null;
  second_disbursement_amount: number | null; second_disbursement_date: string | null;
  status: string; created_at: string; aadhaar_front_path: string | null;
  submitted_at: string | null; reviewed_at: string | null; docs_sent_at: string | null;
  approved_at: string | null; rejected_at: string | null; rejection_reason: string | null;
  epc_updated_at: string | null;
  edit_locked: boolean;   // 0084 — locked after submit
  edit_allow: string[] | null;   // 0085 — rows Capital Craft opened for editing
  attention_status: string | null; attention_raised_at: string | null; msg_epc_seen_at: string | null;
};
type InsRow = {
  id: string; insurance_display_id: string | null; aadhaar_name: string | null;
  sum_insured: number | null; invoice_confirmed_amount: number | null; insurance_partner: string | null;
  policy_from_date: string | null; policy_to_date: string | null; status: string; created_at: string;
  attention_status: string | null; attention_raised_at: string | null; msg_epc_seen_at: string | null;
};

const INS_STATUS_LABEL: Record<string, string> = { draft: "Draft", under_review: "Under Review", issued: "Issued", rejected: "Rejected", hold: "Hold" };
const INS_STATUS_PILL: Record<string, string> = {
  draft: "bg-[#eef1f0] text-[#5a8a76]", under_review: "bg-[#fef0d6] text-[#854f0b]",
  issued: "bg-[#e6f6ee] text-[#178a5c]", rejected: "bg-red-50 text-red-700", hold: "bg-[#dceffb] text-[#185fa5]",
};
type Stage4 = "under_review" | "updated" | "approved" | "rejected";
// Loan-table filter chips: the 4 stages + "all" + the 2nd-tranche-pending view.
type FilterKey = "all" | Stage4 | "tranche_pending";
const STAGE4_LABEL: Record<Stage4, string> = { under_review: "Under review", updated: "Updated", approved: "Approved", rejected: "Rejected" };
const STAGE4_PILL: Record<Stage4, string> = {
  under_review: "bg-[#fef0d6] text-[#854f0b]", updated: "bg-[#e8effc] text-[#1e3a8a]",
  approved: "bg-[#e6f6ee] text-[#178a5c]", rejected: "bg-red-50 text-red-700",
};

type Section = "home" | "loans" | "insurance" | "emi" | "documents";
const ICON: Record<Section, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" />,
  loans: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>,
  insurance: <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />,
  emi: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 11h3M8 15h3" /></>,
  documents: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
};

// Integer → Indian words (Lakh / Crore) for the EMI calculator amount bars.
function amountInWords(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  n = Math.floor(n);
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number): string => (x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? " " + a[x % 10] : ""));
  const three = (x: number): string => { const h = Math.floor(x / 100), r = x % 100; return (h ? a[h] + " Hundred" + (r ? " " : "") : "") + (r ? two(r) : ""); };
  let res = "";
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) res += three(crore) + " Crore ";
  if (lakh) res += two(lakh) + " Lakh ";
  if (thousand) res += two(thousand) + " Thousand ";
  if (n) res += three(n);
  return res.trim();
}
function compactRupees(n: number | null | undefined): string {
  const v = Number(n) || 0;
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2).replace(/\.?0+$/, "")}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2).replace(/\.?0+$/, "")}L`;
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function borrower(r: AppRow): string { return r.borrower_name || r.aadhaar_name || "—"; }
function capacity(r: AppRow): string { return r.project_size == null ? "—" : `${r.project_size} ${(r.project_size_unit ?? "kw").toUpperCase()}`; }
// An EPC may edit an unlocked draft, or a locked file only for the specific rows
// Capital Craft opened via a Message to EPC (the edit_allow grant, 0085).
function canEpcEdit(r: AppRow): boolean { return !r.edit_locked || (Array.isArray(r.edit_allow) && r.edit_allow.length > 0); }
function stage4(r: AppRow): Stage4 {
  if (r.status === "rejected") return "rejected";
  if (["approved", "sent_to_nbfc", "disbursed"].includes(r.status)) return "approved";
  if (r.epc_updated_at) return "updated";
  return "under_review";
}
function statusChangedAt(r: AppRow): string | null {
  const s = stage4(r);
  if (s === "rejected") return r.rejected_at ?? null;
  if (s === "approved") return r.approved_at ?? r.first_disbursement_date ?? null;
  if (s === "updated") return r.epc_updated_at ?? null;
  return null;
}
function lastChangeTs(r: AppRow): number {
  const ts = [r.created_at, r.submitted_at, r.epc_updated_at, r.approved_at, r.rejected_at, r.first_disbursement_date, r.second_disbursement_date]
    .filter(Boolean).map((d) => new Date(d as string).getTime());
  return ts.length ? Math.max(...ts) : 0;
}
const appliedAmount = (r: AppRow) => fmtRupees(r.loan_amount_required ?? r.loan_amount);

export default function DashboardPage() {
  return (
    <AuthGuard allow={["approved"]}>
      <DashboardInner />
    </AuthGuard>
  );
}

function DashboardInner() {
  const router = useRouter();
  const [rows, setRows] = useState<AppRow[]>([]);
  const [insRows, setInsRows] = useState<InsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [insBusy, setInsBusy] = useState(false);
  const [openCase, setOpenCase] = useState<AppRow | null>(null);

  const me = getBusiness();
  const canLoan = loanAccess(me);
  const canInsurance = insuranceAccess(me);
  const [section, setSection] = useState<Section>(canLoan || canInsurance ? "home" : "home");
  const [epcName, setEpcName] = useState(() => shortEpcName(me?.contact_name) || greetingName(me));
  useEffect(() => { void fetchEpcName().then(setEpcName); }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase().from("epc_applications").select(
        "id, borrower_name, aadhaar_name, loan_display_id, loan_amount, loan_amount_required, " +
        "project_size, project_size_unit, sanctioned_amount, first_disbursement_amount, first_disbursement_date, " +
        "second_disbursement_amount, second_disbursement_date, submitted_at, reviewed_at, docs_sent_at, " +
        "approved_at, rejected_at, rejection_reason, epc_updated_at, edit_locked, edit_allow, status, created_at, aadhaar_front_path, " +
        "attention_status, attention_raised_at, msg_epc_seen_at").order("created_at", { ascending: false });
      // Hide blank drafts — a draft with no Aadhaar yet is an abandoned mobile-only
      // shell (the register step creates it); it isn't a real profile until the EPC
      // uploads at least the Aadhaar.
      setRows(((data ?? []) as unknown as AppRow[]).filter((r) => !(r.status === "draft" && !r.aadhaar_front_path)));
      const { data: ins } = await supabase().from("insurance_applications").select(
        "id, insurance_display_id, aadhaar_name, sum_insured, invoice_confirmed_amount, insurance_partner, " +
        "policy_from_date, policy_to_date, status, created_at, attention_status, attention_raised_at, msg_epc_seen_at")
        .order("created_at", { ascending: false });
      setInsRows((ins ?? []) as unknown as InsRow[]);
      setLoading(false);
    })();
  }, []);

  async function startInsurance() {
    if (insBusy) return;
    setInsBusy(true);
    try {
      const res = await fetch("/api/epc/insurance/create", { method: "POST", headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) { alert("Couldn't start the insurance application: " + (data?.error || `HTTP ${res.status}`)); return; }
      router.push(`/dashboard/insurance/${data.application.id}/step-1` as any);
    } catch (e) { alert("Network error: " + (e as Error).message); } finally { setInsBusy(false); }
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  // Profiles Capital Craft has flagged (attention open), loan + insurance — the
  // Document pending section lists them; the sidebar shows the total as a red count.
  const attnCount = rows.filter((r) => r.attention_status === "open").length
    + insRows.filter((r) => r.attention_status === "open").length;

  const sortedLoans = useMemo(() => [...rows].sort((a, b) => lastChangeTs(b) - lastChangeTs(a)), [rows]);

  const NAV: { key: Section; label: string; show: boolean }[] = [
    { key: "home", label: "Dashboard", show: true },
    { key: "loans", label: "Loans", show: canLoan },
    { key: "insurance", label: "Insurance", show: canInsurance },
    { key: "documents", label: "Document pending", show: true },
    { key: "emi", label: "EMI calculator", show: true },
  ];
  const navItems = NAV.filter((n) => n.show);

  function NavButton({ n }: { n: { key: Section; label: string } }) {
    const active = section === n.key;
    const badge = n.key === "documents" ? attnCount : 0;
    return (
      <button onClick={() => setSection(n.key)} title={n.label}
        className={["relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13.5px] font-medium transition-colors justify-center group-hover/side:justify-start", active ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"].join(" ")}>
        <span className="relative shrink-0">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICON[n.key]}</svg>
          {badge > 0 && (
            <span className="group-hover/side:hidden absolute -top-2 -right-2 min-w-[16px] h-[16px] px-1 grid place-items-center rounded-full bg-[#dc2626] text-white text-[9px] font-bold leading-none">{badge > 9 ? "9+" : badge}</span>
          )}
        </span>
        <span className="hidden group-hover/side:inline whitespace-nowrap">{n.label}</span>
        {badge > 0 && (
          <span className="hidden group-hover/side:grid ml-auto min-w-[18px] h-[18px] px-1 place-items-center rounded-full bg-[#dc2626] text-white text-[10px] font-bold leading-none">{badge > 9 ? "9+" : badge}</span>
        )}
      </button>
    );
  }

  return (
    <div className="min-h-screen flex bg-bg-soft">
      <LoginWelcome />

      {/* Sidebar (desktop) — a slim icon rail that expands on hover to reveal
          labels + the full logo, overlaying the content (which reserves 68px). */}
      <div className="hidden md:block w-[68px] shrink-0" aria-hidden />
      <aside className="hidden md:flex group/side fixed top-0 left-0 z-40 h-screen w-[68px] hover:w-[224px] transition-[width] duration-200 ease-out flex-col text-white overflow-hidden shadow-xl" style={{ background: NAVY }}>
        <div className="flex flex-col h-full p-3">
          {/* Logo — mark when collapsed, full logo (on white) when expanded. */}
          <a href="/" className="flex items-center justify-center group-hover/side:justify-start h-11 mb-4 shrink-0">
            <span className="group-hover/side:hidden w-9 h-9 rounded-lg bg-white grid place-items-center shrink-0">
              <img src="/brand/capital-craft-mark.png" alt="" className="w-7 h-7 object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            </span>
            <span className="hidden group-hover/side:flex items-center bg-white rounded-lg px-2.5 h-9">
              <img src="/brand/capital-craft.png" alt="Capital Craft" className="h-6 w-auto object-contain" />
            </span>
          </a>
          <nav className="flex flex-col gap-1 flex-1">{navItems.map((n) => <NavButton key={n.key} n={n} />)}</nav>
          <div className="pt-3 border-t border-white/15 hidden group-hover/side:block">
            <div className="text-[12px] font-semibold truncate">{epcName}</div>
            <button onClick={() => { logout(); router.replace("/login"); }} className="text-[11.5px] text-white/60 hover:text-white mt-1 whitespace-nowrap">Log out</button>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top nav */}
        <div className="md:hidden text-white px-4 py-3 flex items-center gap-3 overflow-x-auto" style={{ background: NAVY }}>
          <img src="/brand/capital-craft-mark.png" alt="" className="w-7 h-7 rounded-md bg-white object-contain p-0.5 shrink-0" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
          {navItems.map((n) => (
            <button key={n.key} onClick={() => setSection(n.key)} className={["relative text-[13px] whitespace-nowrap px-2 py-1 rounded-lg", section === n.key ? "bg-white/20" : "text-white/70"].join(" ")}>
              {n.label}
              {n.key === "documents" && attnCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 grid place-items-center rounded-full bg-[#dc2626] text-white text-[9px] font-bold leading-none">{attnCount > 9 ? "9+" : attnCount}</span>
              )}
            </button>
          ))}
        </div>

        {/* Header */}
        <header className="px-5 sm:px-8 pt-6 pb-2 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-[22px] sm:text-[28px] font-bold text-[#0f3d2e]">नमस्ते, {epcName}</h1>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right hidden sm:block min-w-0">
              <div className="text-[13px] font-semibold text-[#0f3d2e] truncate max-w-[220px]">{epcName}</div>
              <div className="text-[11px] text-text-muted">Portal</div>
            </div>
            <div className="w-10 h-10 rounded-full text-white grid place-items-center font-display font-bold text-[15px]" style={{ background: NAVY_ACCENT }} aria-hidden>{(epcName || "C").slice(0, 1).toUpperCase()}</div>
          </div>
        </header>

        <main className="px-5 sm:px-8 pb-12 pt-3">
          {section === "home" && (
            <HomeSection loans={rows} loading={loading} attnCount={attnCount}
              canLoan={canLoan} canInsurance={canInsurance}
              onApplyLoan={() => router.push("/dashboard/apply/chat" as any)}
              onApplyInsurance={() => void startInsurance()} applyingInsurance={insBusy}
              onOpenCase={(r) => setOpenCase(r)} onEmi={() => setSection("emi")} onAttention={() => setSection("documents")} />
          )}
          {section === "loans" && (
            <LoansSection loans={sortedLoans} loading={loading} canLoan={canLoan}
              onOpenCase={(r) => setOpenCase(r)} onApply={() => router.push("/dashboard/apply/chat" as any)}
              onEdit={(r) => router.push(`/dashboard/apply/chat?id=${r.id}&edit=1` as any)}
              onTranche={(r) => router.push(`/dashboard/${r.id}/disbursement` as any)} />
          )}
          {section === "insurance" && (
            <InsuranceSection insRows={insRows} loading={loading} onApply={() => void startInsurance()} applying={insBusy}
              onOpen={(id) => router.push(`/dashboard/insurance/${id}/step-1` as any)} />
          )}
          {section === "emi" && <EmiSection />}
          {section === "documents" && <DocumentsSection loans={rows} insRows={insRows} onOpenMessage={(kind, id) => router.push(`/dashboard/messages/${kind}/${id}` as any)} />}
        </main>
      </div>

      {openCase && (
        <TimelineDrawer row={openCase} onClose={() => setOpenCase(null)}
          onEdit={() => router.push(`/dashboard/apply/chat?id=${openCase.id}&edit=1` as any)}
          onTranche={() => router.push(`/dashboard/${openCase.id}/disbursement` as any)}
          onMessage={() => router.push(`/dashboard/messages/loan/${openCase.id}` as any)} />
      )}
    </div>
  );
}

// ── Home ──────────────────────────────────────────────────────────────────────
type Period = "today" | "week" | "month" | "quarter" | "year" | "all";
const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Today" }, { key: "week", label: "This week" }, { key: "month", label: "This month" },
  { key: "quarter", label: "This quarter" }, { key: "year", label: "This year" }, { key: "all", label: "All time" },
];
// Current window start + the immediately-preceding window (for the trend deltas).
function periodRange(p: Period): { from: number; prevFrom: number; prevTo: number; comparable: boolean } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const midnight = new Date(y, m, d).getTime();
  const DAY = 86400000;
  switch (p) {
    case "today":   return { from: midnight, prevFrom: midnight - DAY, prevTo: midnight, comparable: true };
    case "week":    { const ws = midnight - ((now.getDay() + 6) % 7) * DAY; return { from: ws, prevFrom: ws - 7 * DAY, prevTo: ws, comparable: true }; }
    case "month":   { const ms = new Date(y, m, 1).getTime(); return { from: ms, prevFrom: new Date(y, m - 1, 1).getTime(), prevTo: ms, comparable: true }; }
    case "quarter": { const qs = new Date(y, Math.floor(m / 3) * 3, 1).getTime(); return { from: qs, prevFrom: new Date(y, Math.floor(m / 3) * 3 - 3, 1).getTime(), prevTo: qs, comparable: true }; }
    case "year":    { const ys = new Date(y, 0, 1).getTime(); return { from: ys, prevFrom: new Date(y - 1, 0, 1).getTime(), prevTo: ys, comparable: true }; }
    default:        return { from: 0, prevFrom: 0, prevTo: 0, comparable: false };
  }
}

// Premium dependency-free donut: separated rounded segments, hover to focus a
// slice (others dim + the centre swaps to that slice's count/label).
function Donut({ segments, size = 176, stroke = 22 }: { segments: { label: string; value: number; color: string }[]; size?: number; stroke?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const nonZero = segments.filter((s) => s.value > 0).length;
  const gap = nonZero > 1 ? stroke + 6 : 0; // clean separation that survives round caps
  let acc = 0;
  const centre = hover != null && segments[hover] ? { big: String(segments[hover].value), small: segments[hover].label } : { big: String(total), small: "Files" };
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef1f0" strokeWidth={stroke} />
          {total > 0 && segments.map((s, i) => {
            if (s.value <= 0) return null;
            const frac = s.value / total;
            const len = Math.max(0.01, frac * C - gap);
            const el = (
              <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color}
                strokeWidth={hover === i ? stroke + 4 : stroke} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} strokeLinecap="round"
                style={{ transition: "stroke-width .15s ease, opacity .15s ease", opacity: hover == null || hover === i ? 1 : 0.35, cursor: "pointer" }}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            );
            acc += frac * C;
            return el;
          })}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-[28px] font-bold text-[#0f3d2e] leading-none tabular-nums">{centre.big}</div>
        <div className="text-[11px] text-text-muted mt-1 max-w-[90px] text-center truncate">{centre.small}</div>
      </div>
    </div>
  );
}

function homeMetrics(list: AppRow[]) {
  return {
    total: list.length,
    approved: list.filter((r) => stage4(r) === "approved").length,
    sanctioned: list.reduce((s, r) => s + (r.sanctioned_amount || 0), 0),
    disbursed: list.reduce((s, r) => s + (r.first_disbursement_amount || 0) + (r.second_disbursement_amount || 0), 0),
    tranchePending: list.filter((r) => stage4(r) === "approved" && r.first_disbursement_amount != null && r.second_disbursement_amount == null).length,
  };
}

function HomeSection({ loans, loading, attnCount, canLoan, canInsurance, onApplyLoan, onApplyInsurance, applyingInsurance, onOpenCase, onEmi, onAttention }: {
  loans: AppRow[]; loading: boolean; attnCount: number;
  canLoan: boolean; canInsurance: boolean;
  onApplyLoan: () => void; onApplyInsurance: () => void; applyingInsurance: boolean;
  onOpenCase: (r: AppRow) => void; onEmi: () => void; onAttention: () => void;
}) {
  const [period, setPeriod] = useState<Period>("all");
  const { from, prevFrom, prevTo, comparable } = periodRange(period);
  const scoped = useMemo(() => loans.filter((r) => new Date(r.created_at).getTime() >= from), [loans, from]);
  const prevScoped = useMemo(() => comparable ? loans.filter((r) => { const t = new Date(r.created_at).getTime(); return t >= prevFrom && t < prevTo; }) : [], [loans, comparable, prevFrom, prevTo]);
  const cur = useMemo(() => homeMetrics(scoped), [scoped]);
  const prev = useMemo(() => homeMetrics(prevScoped), [prevScoped]);

  const breakdown = useMemo(() => {
    let review = 0, approved = 0, rejected = 0;
    for (const r of scoped) { const s = stage4(r); if (s === "approved") approved++; else if (s === "rejected") rejected++; else review++; }
    return { review, approved, rejected };
  }, [scoped]);

  // "Today's activity" is always the last 24h — independent of the period filter.
  const todays = useMemo(() => {
    const since = Date.now() - 86400000;
    return [...loans].filter((r) => lastChangeTs(r) >= since).sort((a, b) => lastChangeTs(b) - lastChangeTs(a)).slice(0, 6);
  }, [loans]);

  const kpis: { label: string; value: string; tone: string; delta?: number; money?: boolean }[] = [
    { label: "Applications", value: String(cur.total), tone: "text-[#0f3d2e]", delta: cur.total - prev.total },
    { label: "Approved", value: String(cur.approved), tone: "text-[#178a5c]", delta: cur.approved - prev.approved },
    { label: "Sanctioned", value: compactRupees(cur.sanctioned), tone: "text-[#0f3d2e]", delta: cur.sanctioned - prev.sanctioned, money: true },
    { label: "Disbursed", value: compactRupees(cur.disbursed), tone: "text-[#0f3d2e]", delta: cur.disbursed - prev.disbursed, money: true },
    { label: "2nd tranche pending", value: String(cur.tranchePending), tone: "text-[#854f0b]" },
  ];
  const segs = [
    { label: "In review", value: breakdown.review, color: "#f0b429" },
    { label: "Approved", value: breakdown.approved, color: "#178a5c" },
    { label: "Rejected", value: breakdown.rejected, color: "#dc2626" },
  ];
  const segTotal = Math.max(1, breakdown.review + breakdown.approved + breakdown.rejected);

  return (
    <div className="flex flex-col gap-5">
      {/* Action bar — start a new application (left) + period filter (right) */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          {canLoan && (
            <button onClick={onApplyLoan}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-[13.5px] font-semibold shadow-sm hover:brightness-110 active:scale-[0.98] transition"
              style={{ background: NAVY_ACCENT }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
              Apply for loan
            </button>
          )}
          {canInsurance && (
            <button onClick={onApplyInsurance} disabled={applyingInsurance}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-[#1e3a8a] text-[#1e3a8a] text-[13.5px] font-semibold hover:bg-[#1e3a8a]/[0.06] active:scale-[0.98] transition disabled:opacity-60">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /></svg>
              {applyingInsurance ? "Starting…" : "Apply for insurance"}
            </button>
          )}
        </div>
        <div className="relative shrink-0">
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}
            className="appearance-none bg-white border border-line rounded-xl pl-3.5 pr-9 py-2 text-[13px] font-semibold text-[#0f3d2e] cursor-pointer hover:border-[#1e3a8a] focus:outline-none focus:border-[#1e3a8a]">
            {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5a8a76" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </div>
      </div>

      {/* KPI band — each card shows the value + its change vs the previous period */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white rounded-2xl border border-line px-4 py-3.5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-150">
            <div className="text-[11.5px] text-text-muted">{k.label}</div>
            <div className={`text-[22px] font-bold mt-0.5 ${k.tone}`}>{loading ? "…" : k.value}</div>
            {comparable && k.delta !== undefined && (
              <div title="vs previous period" className={["mt-1 inline-flex items-center gap-1 text-[11px] font-semibold", k.delta > 0 ? "text-[#178a5c]" : k.delta < 0 ? "text-[#dc2626]" : "text-text-muted"].join(" ")}>
                <span aria-hidden>{k.delta > 0 ? "▲" : k.delta < 0 ? "▼" : "–"}</span>
                {k.money ? compactRupees(Math.abs(k.delta)) : Math.abs(k.delta)}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Left: portfolio donut + today's activity */}
        <div className="lg:col-span-2 flex flex-col gap-5">
          <div className="bg-white rounded-2xl border border-line p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[13px] font-semibold text-[#0f3d2e]">Portfolio breakdown</div>
              {attnCount > 0 && (
                <button onClick={onAttention} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2.5 py-1 rounded-full bg-[#fde8e8] text-[#dc2626] hover:bg-[#fbd5d5] transition-colors">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#dc2626]" />{attnCount} need attention
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
              )}
            </div>
            <div className="flex flex-col sm:flex-row items-center gap-8 mt-4">
              <Donut segments={segs} />
              <div className="flex-1 w-full flex flex-col gap-3">
                {segs.map((s) => (
                  <div key={s.label} className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                    <span className="text-[13px] text-text-mid flex-1">{s.label}</span>
                    <span className="text-[15px] font-bold text-[#0f3d2e] tabular-nums">{s.value}</span>
                    <span className="text-[11.5px] text-text-muted w-9 text-right tabular-nums">{Math.round((s.value / segTotal) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-line p-5">
            <div className="text-[13px] font-semibold text-[#0f3d2e] mb-3">Today&rsquo;s activity</div>
            {loading ? <div className="text-[13px] text-text-muted">Loading…</div>
              : todays.length === 0 ? <div className="text-[13px] text-text-muted">No status changes in the last 24 hours.</div>
              : <div className="flex flex-col gap-2">
                  {todays.map((r) => {
                    const stg = stage4(r);
                    return (
                      <button key={r.id} onClick={() => onOpenCase(r)} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-2.5 hover:bg-[#f7f9fe] text-left">
                        <div className="min-w-0"><div className="text-[13.5px] font-semibold text-text truncate">{borrower(r)}</div><div className="text-[11px] text-text-muted">{fmtDateTime(statusChangedAt(r) ?? r.created_at)}</div></div>
                        <span className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full ${STAGE4_PILL[stg]}`}>{STAGE4_LABEL[stg]}</span>
                      </button>
                    );
                  })}
                </div>}
          </div>
        </div>

        {/* Right: EMI tile · disbursement progress · relationship managers */}
        <div className="flex flex-col gap-5">
          <button onClick={onEmi} className="bg-white rounded-2xl border border-line p-5 text-left hover:border-[#1e3a8a] transition-colors">
            <div className="text-[12px] text-text-muted">Quote a customer&rsquo;s EMI</div>
            <div className="text-[15px] font-semibold text-[#1e3a8a] mt-1 flex items-center gap-1.5">Open EMI calculator
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </div>
            <div className="text-[11.5px] text-text-muted mt-1">EMI after the PM Surya Ghar subsidy, in seconds.</div>
          </button>

          <div className="bg-white rounded-2xl border border-line p-5">
            <div className="text-[12px] text-text-muted mb-3">Your relationship managers</div>
            <div className="flex flex-col gap-3">
              {RMS.map((rm) => (
                <div key={rm.phone} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full grid place-items-center text-white font-bold text-[13px] shrink-0" style={{ background: NAVY_ACCENT }}>{rm.name.slice(0, 1)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold text-text truncate">{rm.name}</div>
                    <div className="text-[11px] text-text-muted">+{rm.phone}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Loans ─────────────────────────────────────────────────────────────────────
function LoansSection({ loans, loading, canLoan, onOpenCase, onApply, onEdit, onTranche }: {
  loans: AppRow[]; loading: boolean; canLoan: boolean;
  onOpenCase: (r: AppRow) => void; onApply: () => void; onEdit: (r: AppRow) => void; onTranche: (r: AppRow) => void;
}) {
  const [q, setQ] = useState("");
  const [sf, setSf] = useState<FilterKey>("all");
  // Approved file with the 1st tranche released but the 2nd still pending.
  const isTranchePending = (r: AppRow) => stage4(r) === "approved" && r.first_disbursement_amount != null && r.second_disbursement_amount == null;
  const matchesFilter = (r: AppRow) => sf === "all" ? true : sf === "tranche_pending" ? isTranchePending(r) : stage4(r) === sf;
  const count = (k: FilterKey) => (k === "all" ? loans.length : k === "tranche_pending" ? loans.filter(isTranchePending).length : loans.filter((r) => stage4(r) === k).length);
  const needle = q.trim().toLowerCase();
  const filtered = loans.filter((r) => {
    if (!matchesFilter(r)) return false;
    if (needle && !(borrower(r).toLowerCase().includes(needle) || (r.loan_display_id || "").toLowerCase().includes(needle))) return false;
    return true;
  });
  const CHIPS: { key: FilterKey; label: string }[] = [
    { key: "all", label: "All" }, { key: "under_review", label: "Under review" },
    { key: "updated", label: "Updated" }, { key: "approved", label: "Approved" },
    { key: "tranche_pending", label: "2nd tranche pending" }, { key: "rejected", label: "Rejected" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h2 className="font-display text-[20px] font-bold text-[#0f3d2e]">Your loan applications</h2>
          <p className="text-text-mid text-[13px] mt-0.5">Where each file stands — newest change on top.</p></div>
        {canLoan && <button onClick={onApply} className="px-4 py-2 rounded-xl text-white text-[13px] font-semibold" style={{ background: NAVY_ACCENT }}>Apply for loan</button>}
      </div>

      {/* Search + status filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-[420px] bg-white border border-line rounded-xl px-3.5 h-11 focus-within:border-[#1e3a8a] focus-within:ring-2 focus-within:ring-[#1e3a8a]/15 transition">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by borrower or loan ID…" className="flex-1 min-w-0 bg-transparent text-[14px] text-text outline-none placeholder:text-text-muted" />
          {q && <button onClick={() => setQ("")} className="text-text-muted hover:text-text text-[15px] leading-none" aria-label="Clear">✕</button>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {CHIPS.map((c) => {
            const active = sf === c.key;
            return (
              <button key={c.key} onClick={() => setSf(c.key)}
                className={["px-3.5 py-2 rounded-full text-[12.5px] font-semibold border transition-colors inline-flex items-center gap-1.5", active ? "text-white border-transparent" : "bg-white border-line text-text-mid hover:border-[#1e3a8a]"].join(" ")}
                style={active ? { background: NAVY_ACCENT } : undefined}>
                {c.label}
                <span className={["text-[10.5px] px-1.5 rounded-full", active ? "bg-white/25 text-white" : "bg-bg-soft text-text-muted"].join(" ")}>{count(c.key)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-line overflow-x-auto">
        <table className="w-full text-[13.5px] min-w-[820px]">
          <thead className="bg-bg-soft border-b border-line">
            <tr className="text-left text-text-muted text-[12px]">
              <th className="px-4 py-3 font-medium">Borrower</th><th className="px-3 py-3 font-medium">Plant capacity</th><th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium">Loan amount</th><th className="px-3 py-3 font-medium">Loan approved</th><th className="px-3 py-3 font-medium">1st tranche</th>
              <th className="px-3 py-3 font-medium">2nd tranche</th><th className="px-3 py-3 font-medium">Days remaining</th><th className="px-3 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={9} className="px-5 py-8 text-center text-text-muted">Loading…</td></tr>
              : loans.length === 0 ? <tr><td colSpan={9} className="px-5 py-12 text-center text-text-muted">No applications yet. Click <span className="text-text font-semibold">Apply for loan</span> to start one.</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={9} className="px-5 py-12 text-center text-text-muted">No applications match your search or filter.</td></tr>
              : filtered.map((r) => {
                const stg = stage4(r); const approved = stg === "approved"; const rejected = stg === "rejected"; const changedAt = statusChangedAt(r);
                return (
                  <tr key={r.id} onClick={() => onOpenCase(r)} className="border-b border-line hover:bg-[#f0faf5] cursor-pointer">
                    <td className="px-4 py-3.5 align-top">
                      <div className="flex items-center gap-1.5">{r.attention_status === "open" && <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" title="Capital Craft messaged you" />}<span className="font-semibold text-text">{borrower(r)}</span></div>
                      {r.loan_display_id && <div className="text-[11px] font-mono text-[#185fa5] mt-0.5">{r.loan_display_id}</div>}
                      <div className="text-[10.5px] text-text-muted mt-0.5">Created {fmtDateTime(r.created_at)}</div>
                    </td>
                    <td className="px-3 py-3.5 align-top whitespace-nowrap">{capacity(r)}</td>
                    <td className="px-3 py-3.5 align-top"><span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold ${STAGE4_PILL[stg]}`}>{STAGE4_LABEL[stg]}</span>{changedAt && <div className="text-[10.5px] text-text-muted mt-1 whitespace-nowrap">{fmtDateTime(changedAt)}</div>}</td>
                    <td className="px-3 py-3.5 align-top font-semibold text-[#0f3d2e] whitespace-nowrap">{appliedAmount(r)}</td>
                    <td className="px-3 py-3.5 align-top whitespace-nowrap">{approved && r.sanctioned_amount != null ? <span className="font-semibold text-[#178a5c]">{fmtRupees(r.sanctioned_amount)}</span> : <span className="text-text-muted">—</span>}</td>
                    <td className="px-3 py-3.5 align-top whitespace-nowrap">{r.first_disbursement_amount != null ? <><div className="font-semibold text-[#0f3d2e]">{fmtRupees(r.first_disbursement_amount)}</div><div className="text-[10.5px] text-text-muted">{fmtDateShort(r.first_disbursement_date)}</div></> : <span className="text-text-muted">—</span>}</td>
                    <td className="px-3 py-3.5 align-top whitespace-nowrap">{r.second_disbursement_amount != null ? <><div className="font-semibold text-[#0f3d2e]">{fmtRupees(r.second_disbursement_amount)}</div><div className="text-[10.5px] text-text-muted">{fmtDateShort(r.second_disbursement_date)}</div></> : approved && r.first_disbursement_amount != null ? <span className="text-[11px] font-semibold text-amber-700">Pending</span> : <span className="text-text-muted">—</span>}</td>
                    <td className="px-3 py-3.5 align-top whitespace-nowrap">{!approved ? <span className="text-text-muted">—</span> : (() => { const dl = deadlineState(r.first_disbursement_date); return <span className={["inline-block px-2 py-1 rounded-[6px] text-[11px] font-semibold whitespace-nowrap", DEADLINE_PILL[dl.tone]].join(" ")}>{dl.label}</span>; })()}</td>
                    <td className="px-3 py-3.5 align-top whitespace-nowrap">
                      {approved ? <button onClick={(e) => { e.stopPropagation(); onTranche(r); }} className="px-3 py-1.5 rounded-lg text-white text-[12px] font-semibold" style={{ background: NAVY_ACCENT }}>2nd tranche</button>
                        : rejected ? <button onClick={(e) => { e.stopPropagation(); onOpenCase(r); }} className="px-3 py-1.5 rounded-lg border border-line text-[12px] font-semibold text-text-mid">View</button>
                        : canEpcEdit(r) ? <button onClick={(e) => { e.stopPropagation(); onEdit(r); }} className="px-4 py-1.5 rounded-lg border border-[#1e3a8a] text-[#1e3a8a] text-[12px] font-semibold hover:bg-[#1e3a8a]/[0.06]">Edit</button>
                        : <span className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-lg border border-line text-text-muted text-[12px] font-semibold cursor-not-allowed select-none"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>Edit</span>}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Insurance ─────────────────────────────────────────────────────────────────
function InsuranceSection({ insRows, loading, onApply, applying, onOpen }: {
  insRows: InsRow[]; loading: boolean; onApply: () => void; applying: boolean; onOpen: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [sf, setSf] = useState<"all" | "under_review" | "issued" | "hold" | "rejected" | "expiring">("all");
  const daysLeft = (r: InsRow) => policyValidityParts(r.policy_from_date, r.policy_to_date)?.daysLeft ?? null;
  const isExpiring = (r: InsRow) => { const d = daysLeft(r); return d !== null && d >= 0 && d <= 30; };
  const count = (k: typeof sf) => (k === "all" ? insRows.length : k === "expiring" ? insRows.filter(isExpiring).length : insRows.filter((r) => r.status === k).length);
  const needle = q.trim().toLowerCase();
  const filtered = [...insRows]
    .sort((a, b) => (b.attention_status === "open" ? 1 : 0) - (a.attention_status === "open" ? 1 : 0))
    .filter((r) => {
      if (sf === "expiring" ? !isExpiring(r) : sf !== "all" && r.status !== sf) return false;
      if (needle && !((r.aadhaar_name || "").toLowerCase().includes(needle) || (r.insurance_display_id || "").toLowerCase().includes(needle))) return false;
      return true;
    });
  const CHIPS: { key: typeof sf; label: string }[] = [
    { key: "all", label: "All" }, { key: "under_review", label: "Under review" }, { key: "issued", label: "Issued" },
    { key: "hold", label: "Hold" }, { key: "rejected", label: "Rejected" }, { key: "expiring", label: "Expiring soon" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h2 className="font-display text-[20px] font-bold text-[#0f3d2e]">Your insurance applications</h2>
          <p className="text-text-mid text-[13px] mt-0.5">Plants you&rsquo;ve submitted for insurance and where each stands.</p></div>
        <button onClick={onApply} disabled={applying} className="px-4 py-2 rounded-xl text-white text-[13px] font-semibold disabled:opacity-60" style={{ background: NAVY_ACCENT }}>{applying ? "Starting…" : "Apply for insurance"}</button>
      </div>

      {/* Search + status/expiry filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-[420px] bg-white border border-line rounded-xl px-3.5 h-11 focus-within:border-[#1e3a8a] focus-within:ring-2 focus-within:ring-[#1e3a8a]/15 transition">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by insured or INS ID…" className="flex-1 min-w-0 bg-transparent text-[14px] text-text outline-none placeholder:text-text-muted" />
          {q && <button onClick={() => setQ("")} className="text-text-muted hover:text-text text-[15px] leading-none" aria-label="Clear">✕</button>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {CHIPS.map((c) => {
            const active = sf === c.key;
            return (
              <button key={c.key} onClick={() => setSf(c.key)}
                className={["px-3.5 py-2 rounded-full text-[12.5px] font-semibold border transition-colors inline-flex items-center gap-1.5", active ? "text-white border-transparent" : "bg-white border-line text-text-mid hover:border-[#1e3a8a]"].join(" ")}
                style={active ? { background: NAVY_ACCENT } : undefined}>
                {c.label}
                <span className={["text-[10.5px] px-1.5 rounded-full", active ? "bg-white/25 text-white" : "bg-bg-soft text-text-muted"].join(" ")}>{count(c.key)}</span>
              </button>
            );
          })}
        </div>
      </div>

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
                <tr key={r.id} onClick={() => onOpen(r.id)} className="border-b border-line cursor-pointer hover:bg-[#f0faf5]">
                  <td className="px-5 py-4"><div className="text-[15px] font-semibold text-text">{r.aadhaar_name || "—"}</div>{r.insurance_display_id && <div className="text-[12px] font-mono text-[#185fa5] mt-0.5">{r.insurance_display_id}</div>}{r.attention_status === "open" && <div className="mt-1"><span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Action needed</span></div>}</td>
                  <td className="px-5 py-4 font-semibold text-[#0f3d2e]">{fmtRupees(r.sum_insured ?? r.invoice_confirmed_amount)}</td>
                  <td className="px-5 py-4">{r.insurance_partner || "—"}</td>
                  <td className="px-5 py-4"><span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide ${INS_STATUS_PILL[r.status] ?? INS_STATUS_PILL.draft}`}>{INS_STATUS_LABEL[r.status] ?? r.status}</span></td>
                  <td className="px-5 py-4">{(() => { const v = policyValidityParts(r.policy_from_date, r.policy_to_date); return v ? <span className={`text-[12px] font-medium ${VALIDITY_TEXT[v.tone]}`}>{v.text}</span> : <span className="text-text-muted">—</span>; })()}</td>
                  <td className="px-5 py-4 text-text-muted whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── EMI calculator ────────────────────────────────────────────────────────────
function EmiSection() {
  const [size, setSize] = useState("");
  const [cost, setCost] = useState("");
  const [loan, setLoan] = useState("");
  const [tenure, setTenure] = useState<number>(5);
  const sizeN = Number(size) || 0, costN = Number(cost) || 0, loanN = Number(loan) || 0;
  const central = sizeN > 0 ? computeCentralSubsidy(sizeN) : 0;
  const net = Math.max(0, loanN - central);
  const emi = net > 0 ? computeEmi(net, DEFAULT_INDICATIVE_ROI, tenure) : 0;
  // Dark, bold typed numbers; grey normal placeholder examples.
  const inputCls = "mt-2 w-full border border-line rounded-xl px-4 py-3 text-[17px] font-semibold text-[#0f3d2e] placeholder:font-normal placeholder:text-text-muted focus:outline-none focus:border-[#1e3a8a] focus:ring-2 focus:ring-[#1e3a8a]/15";
  const labelCls = "block text-[13.5px] font-medium text-text-mid";
  const wordsBar = (n: number) => n > 0 ? (
    <div className="mt-2 text-[13px] font-semibold text-[#14235c] bg-[#f4f7fd] border border-[#e0e7f5] rounded-xl px-3.5 py-2">
      {amountInWords(n)} rupees
    </div>
  ) : null;
  return (
    <div className="max-w-[820px]">
      <h2 className="font-display text-[24px] font-bold text-[#0f3d2e] mb-6">EMI &amp; subsidy calculator</h2>
      <div className="bg-white rounded-3xl border border-line p-6 sm:p-7">
        <div className="grid md:grid-cols-2 gap-6 md:gap-9">
          {/* Left — inputs */}
          <div className="flex flex-col gap-5">
            <div>
              <label className={labelCls}>System size (kW)</label>
              <input value={size} inputMode="decimal" placeholder="e.g. 3" onChange={(e) => setSize(e.target.value.replace(/[^\d.]/g, ""))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Project cost (₹)</label>
              <input value={cost} inputMode="numeric" placeholder="e.g. 3,00,000" onChange={(e) => setCost(e.target.value.replace(/[^\d]/g, ""))} className={inputCls} />
              {wordsBar(costN)}
            </div>
            <div>
              <label className={labelCls}>Loan amount (₹)</label>
              <input value={loan} inputMode="numeric" placeholder="e.g. 2,50,000" onChange={(e) => setLoan(e.target.value.replace(/[^\d]/g, ""))} className={inputCls} />
              {wordsBar(loanN)}
            </div>
          </div>

          {/* Right — results */}
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-bg-soft rounded-2xl px-5 py-4"><div className="text-[12.5px] text-text-muted">Central subsidy</div><div className="text-[20px] font-bold text-[#178a5c] mt-0.5">{sizeN > 0 ? `− ${fmtRupees(central)}` : "—"}</div></div>
              <div className="bg-bg-soft rounded-2xl px-5 py-4"><div className="text-[12.5px] text-text-muted">Net loan</div><div className="text-[20px] font-bold text-[#0f3d2e] mt-0.5">{loanN > 0 ? fmtRupees(net) : "—"}</div></div>
            </div>
            <div>
              <div className="text-[13.5px] font-medium text-text-mid mb-2.5">Tenure</div>
              <div className="grid grid-cols-5 gap-2.5">
                {TENURES.map((t) => (
                  <button key={t} onClick={() => setTenure(t)} className={["py-3 rounded-xl text-center border text-[14px] font-bold transition-colors", tenure === t ? "text-white border-transparent" : "bg-white border-line text-text-mid hover:border-[#1e3a8a]"].join(" ")} style={tenure === t ? { background: NAVY_ACCENT } : undefined}>{t}y</button>
                ))}
              </div>
            </div>
            <div className="rounded-2xl px-6 py-5 flex-1 flex flex-col justify-center" style={{ background: "#e8effc" }}>
              <div className="text-[13px] text-[#1e3a8a]">Monthly EMI · {tenure} years</div>
              <div className="text-[34px] font-bold text-[#1e3a8a] leading-tight">{net > 0 ? formatRupees(emi) : "—"}<span className="text-[15px] font-medium">/mo</span></div>
            </div>
          </div>
        </div>
        <p className="text-[12px] text-text-muted mt-5">Indicative only — the final rate is set by the lender after review.</p>
      </div>
    </div>
  );
}

// ── Documents (first pass) ──────────────────────────────────────────────────────
// Document pending — the profiles Capital Craft has flagged (attention open) so
// the EPC can read the message, update the required documents/details and
// re-submit. Two tabs: Loan / Insurance, each with its own count.
function DocumentsSection({ loans, insRows, onOpenMessage }: {
  loans: AppRow[]; insRows: InsRow[];
  onOpenMessage: (kind: "loan" | "insurance", id: string) => void;
}) {
  const unseen = (r: { msg_epc_seen_at: string | null; attention_raised_at: string | null }) =>
    !r.msg_epc_seen_at || (!!r.attention_raised_at && r.msg_epc_seen_at < r.attention_raised_at);
  const loanPending = loans.filter((r) => r.attention_status === "open");
  const insPending = insRows.filter((r) => r.attention_status === "open");
  const [tab, setTab] = useState<"loan" | "insurance">(loanPending.length === 0 && insPending.length > 0 ? "insurance" : "loan");

  const items = tab === "loan"
    ? loanPending.map((r) => ({ id: r.id, kind: "loan" as const, name: borrower(r), ref: r.loan_display_id, isNew: unseen(r) }))
    : insPending.map((r) => ({ id: r.id, kind: "insurance" as const, name: r.aadhaar_name || "—", ref: r.insurance_display_id, isNew: unseen(r) }));

  return (
    <div className="max-w-[860px] flex flex-col gap-5">
      <div>
        <h2 className="font-display text-[22px] font-bold text-[#0f3d2e]">Document pending</h2>
      </div>

      {/* Loan / Insurance tabs, each with its pending count */}
      <div className="flex gap-2">
        {([["loan", "Loan", loanPending.length], ["insurance", "Insurance", insPending.length]] as const).map(([k, label, n]) => (
          <button key={k} onClick={() => setTab(k)}
            className={["px-4 py-2 rounded-xl text-[13px] font-semibold border transition-colors flex items-center gap-2", tab === k ? "text-white border-[#14235c]" : "bg-white text-text-mid border-line hover:border-[#14235c]"].join(" ")}
            style={tab === k ? { background: NAVY } : undefined}>
            {label}
            {n > 0 && <span className={["inline-grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold leading-none", tab === k ? "bg-white/20 text-white" : "bg-[#fde8e8] text-[#dc2626]"].join(" ")}>{n}</span>}
          </button>
        ))}
      </div>

      {/* List */}
      {items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-line px-6 py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-[#e6f6ee] grid place-items-center mx-auto mb-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#178a5c" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <div className="text-[14px] font-semibold text-[#0f3d2e]">You&apos;re all caught up</div>
          <div className="text-[12.5px] text-text-muted mt-1">No {tab === "loan" ? "loan" : "insurance"} profiles need your attention right now.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((it) => (
            <button key={it.id} onClick={() => onOpenMessage(it.kind, it.id)}
              className="group text-left bg-white rounded-2xl border border-line hover:border-[#1e3a8a]/40 hover:shadow-md transition-all px-5 py-4 flex items-center gap-4">
              <span className="relative w-11 h-11 rounded-xl grid place-items-center shrink-0 bg-[#eef3fc] text-[#1e3a8a]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                {it.isNew && <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-[#dc2626] border-2 border-white" aria-label="New" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-text truncate">{it.name}</div>
                <div className="text-[12px] text-text-muted mt-0.5">
                  {it.ref && <span className="font-mono text-[#185fa5]">{it.ref}</span>}{it.ref ? " · " : ""}
                  Capital Craft sent a message{it.isNew ? <span className="text-[#dc2626] font-semibold"> · New</span> : ""}
                </div>
              </div>
              <span className="shrink-0 flex items-center gap-1 text-[12.5px] font-semibold text-[#1e3a8a] group-hover:gap-2 transition-all">
                Open <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Per-application timeline drawer ─────────────────────────────────────────────
function TimelineDrawer({ row, onClose, onEdit, onTranche, onMessage }: {
  row: AppRow; onClose: () => void; onEdit: () => void; onTranche: () => void; onMessage: () => void;
}) {
  const stg = stage4(row);
  const rejected = stg === "rejected";
  type Step = { label: string; at: string | null; note?: string; amount?: number | null };
  const steps: Step[] = [
    { label: "Submitted", at: row.submitted_at ?? row.created_at },
    { label: "Under review", at: row.submitted_at ?? row.created_at, note: "Our team is reviewing the file" },
    { label: "Documents verified", at: row.docs_sent_at ?? row.reviewed_at },
    { label: "Sanctioned", at: row.approved_at, amount: row.sanctioned_amount },
    { label: "1st disbursement", at: row.first_disbursement_date, amount: row.first_disbursement_amount },
    { label: "2nd disbursement", at: row.second_disbursement_date, amount: row.second_disbursement_amount },
  ];
  const firstPendingIdx = steps.findIndex((s) => !s.at);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <aside onClick={(e) => e.stopPropagation()} className="relative w-full max-w-[440px] h-full bg-white shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-line px-5 py-4 flex items-start justify-between gap-3">
          <div><div className="font-display text-[18px] font-bold text-[#0f3d2e]">{borrower(row)}</div>
            <div className="text-[11px] font-mono text-[#185fa5]">{row.loan_display_id ?? row.id.slice(0, 8).toUpperCase()}</div></div>
          <button onClick={onClose} className="text-text-muted hover:text-text text-[20px] leading-none">✕</button>
        </div>

        <div className="px-5 py-4">
          <div className="flex items-center gap-2 mb-4">
            <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${STAGE4_PILL[stg]}`}>{STAGE4_LABEL[stg]}</span>
            <span className="text-[12px] text-text-mid">{appliedAmount(row)} applied · {capacity(row)}</span>
          </div>

          {/* Timeline */}
          <div className="flex flex-col">
            {steps.map((s, i) => {
              const done = !!s.at;
              const current = !rejected && i === firstPendingIdx;
              const showLine = i < steps.length - 1;
              const stop = rejected && !done; // stop drawing active steps past the rejection
              return (
                <div key={s.label} className={["flex gap-3", stop ? "opacity-40" : ""].join(" ")}>
                  <div className="flex flex-col items-center">
                    <div className={["w-6 h-6 rounded-full grid place-items-center shrink-0",
                      done ? "bg-[#178a5c] text-white" : current ? "text-white" : "border-2 border-line text-text-muted"].join(" ")}
                      style={current ? { background: NAVY_ACCENT } : undefined}>
                      {done ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg> : current ? <span className="w-2 h-2 rounded-full bg-white" /> : <span className="w-1.5 h-1.5 rounded-full bg-line" />}
                    </div>
                    {showLine && <div className="w-0.5 flex-1 min-h-[26px]" style={{ background: done ? "#178a5c" : "#e5e7eb" }} />}
                  </div>
                  <div className="pb-4">
                    <div className={["text-[13.5px]", done || current ? "font-semibold text-text" : "text-text-muted"].join(" ")}>{s.label}{current ? " — in progress" : ""}</div>
                    {s.at && <div className="text-[11px] text-text-muted mt-0.5">{fmtDateTime(s.at)}{s.amount != null ? ` · ${fmtRupees(s.amount)}` : ""}</div>}
                    {!s.at && current && s.note && <div className="text-[11px] text-text-muted mt-0.5">{s.note}</div>}
                  </div>
                </div>
              );
            })}
            {rejected && (
              <div className="flex gap-3">
                <div className="flex flex-col items-center"><div className="w-6 h-6 rounded-full bg-red-600 text-white grid place-items-center shrink-0"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg></div></div>
                <div className="pb-2">
                  <div className="text-[13.5px] font-semibold text-red-700">Rejected</div>
                  {row.rejected_at && <div className="text-[11px] text-text-muted mt-0.5">{fmtDateTime(row.rejected_at)}</div>}
                  {row.rejection_reason && <div className="text-[12px] text-red-700 mt-1.5 bg-red-50 border border-red-100 rounded-lg px-3 py-2">Reason: {row.rejection_reason}</div>}
                  <div className="text-[12px] text-text-mid mt-2">Please review the file and re-submit with the corrections.</div>
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 mt-4 flex-wrap">
            {stg === "approved" ? (
              <button onClick={onTranche} className="flex-1 px-4 py-2.5 rounded-xl text-white text-[13px] font-semibold" style={{ background: NAVY_ACCENT }}>Upload 2nd tranche</button>
            ) : canEpcEdit(row) ? (
              stg !== "rejected" ? (
                <button onClick={onEdit} className="flex-1 px-4 py-2.5 rounded-xl text-white text-[13px] font-semibold" style={{ background: NAVY_ACCENT }}>Edit application</button>
              ) : (
                <button onClick={onEdit} className="flex-1 px-4 py-2.5 rounded-xl border border-[#1e3a8a] text-[#1e3a8a] text-[13px] font-semibold">Re-submit</button>
              )
            ) : (
              <div className="flex-1 px-4 py-2.5 rounded-xl border border-line text-text-muted text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 select-none">
                Awaiting review
              </div>
            )}
            {row.attention_status === "open" && <button onClick={onMessage} className="px-4 py-2.5 rounded-xl border border-line text-[13px] font-semibold text-text-mid">Open message</button>}
          </div>
        </div>
      </aside>
    </div>
  );
}
