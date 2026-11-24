"use client";

// Pendings — /admin/pendings (main admin only).
//
// The checker side of the maker-checker flow (lib/review): approval details and
// 1st / 2nd disbursements a team member saved (locked for them), and EPC
// profiles the team approved, wait here for the main admin — who can open the
// sanction letter, View / Edit, Send back with a reason, or Approve (the same
// ReviewBar as each stage of the loan profile). A decided row stays on screen
// with its result and an Undo until the page is reopened.
// One query per list on open (+ the letters of the pending loans); decisions
// update the list locally (no refetch).
// Back from a profile opened here returns here, with that row's section open and
// the row blinking — as on the Loans / EPC lists (components/view/hooks + kit).
// Each section is a dropdown (closed when the page opens) with its own search.
// Custom template requests: Ready (the EPC is told; still locked) → Unlock (the
// EPC can use it — once it has bought the premium subscription).

import { Children, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import AdminSidebar, { ACCENTS, SectionMark, themeStyle } from "@/components/AdminSidebar";
import ReviewBar from "@/components/ReviewBar";
import { supabase } from "@/lib/supabase";
import { getBusiness, isMainAdmin } from "@/lib/auth";
import { fmtRupeesExact } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { invalidateLoanBoards } from "@/lib/ops-board";
import { useLenders } from "@/lib/lenders";
import { lenderLabelIn } from "@/lib/loan-lenders";
import { getDocumentUrl } from "@/lib/storage";
import { approveEpcReview, rememberPendingCount, PENDING_FILTER, REVIEW_LABEL, REVIEW_TAB, type ReviewItem } from "@/lib/review";
import { invalidate } from "@/lib/list-cache";
import { shortEpcName } from "@/lib/epc-name";
import { clearReturn, rememberReturn } from "@/components/view/hooks";
import { saveCustomTemplate, type Tpl } from "@/components/CustomTemplateCard";
import { customState, READY_CONFIRM, UNLOCK_CONFIRM } from "@/lib/custom-template";
import { askConfirm } from "@/lib/confirm";
import { highlightRowStyle, useReturnHighlight } from "../_console/kit";

type Row = Record<string, any>;
// An EPC's custom template request: its sample quotation(s) + its newest template (none = not built yet).
type Req = { id: string; name: string; at: string; docs: Row[]; tpl: Tpl | null };
type SectionKey = "epc" | "req" | "approval" | "disb";

export default function PendingsPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

const name = (r: Row) => r.aadhaar_name || r.borrower_name || "—";
const epcFull = (b: Row | null | undefined) => b?.trade_name || b?.legal_name || b?.contact_name || "";
// The EPC name without its legal suffix ("… ENTERPRISES PRIVATE LIMITED"); the full name on hover.
const epcShort = (b: Row | null | undefined) => {
  const full = epcFull(b);
  return full ? <span title={full}>{shortEpcName(full)}</span> : "—";
};
const epc = (r: Row) => epcShort(r.epc_business);
// A section's search: one of the row's names / IDs contains the text.
const matches = (q: string | undefined, ...vals: unknown[]) => {
  const t = (q ?? "").trim().toLowerCase();
  return !t || vals.some((v) => typeof v === "string" && v.toLowerCase().includes(t));
};
// Which section a remembered row key belongs to (see rememberRow's callers).
const sectionOf = (rowKey: string): SectionKey =>
  rowKey.startsWith("epc") ? "epc" : rowKey.startsWith("req") ? "req" : rowKey.endsWith("approval") ? "approval" : "disb";
const newest = (ts: Row[] | undefined): Tpl | null =>
  ([...(ts ?? [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] as Tpl | undefined) ?? null;

// Leaving for a profile: Back there comes here; this row (its key) blinks.
const SCROLL_KEY = "pendings.scroll";
const ROW_KEY = "pendings.lastRowId";
function rememberRow(rowKey: string, href: string) {
  rememberReturn("/admin/pendings", href);
  try {
    sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
    sessionStorage.setItem(ROW_KEY, rowKey);
  } catch { /* storage blocked */ }
}

function Inner() {
  const router = useRouter();
  const allowed = isMainAdmin(getBusiness());
  const lenders = useLenders();
  const [rows, setRows] = useState<Row[] | null>(null);
  // The items that were pending when the page opened — they stay listed (with
  // their result + Undo) after a decision.
  const [items, setItems] = useState<Array<{ id: string; k: ReviewItem }>>([]);
  const [letters, setLetters] = useState<Row[]>([]);
  const [epcRows, setEpcRows] = useState<Row[] | null>(null);
  // EPCs whose sample quotation waits for its custom template to be made ready
  // and unlocked (0122).
  const [requests, setRequests] = useState<Req[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0); // bumped by clicking Pendings in the sidebar
  const [open, setOpen] = useState<Partial<Record<SectionKey, boolean>>>({});
  const [find, setFind] = useState<Partial<Record<SectionKey, string>>>({});
  useEffect(() => { clearReturn(); }, []);

  useEffect(() => {
    if (!allowed) { router.replace("/admin"); return; }
    void (async () => {
      const [{ data, error: e }, { data: epcs, error: e2 }, { data: samples }] = await Promise.all([
        supabase()
          .from("epc_applications")
          .select("id, loan_display_id, aadhaar_name, borrower_name, approved_lender, sanctioned_amount, approval_details, reviewed_by, sanction_letter_unavailable, approval_review_status, approval_review_note, approval_reviewed_at, first_disbursement_amount, first_disbursement_date, disb1_review_status, disb1_review_note, disb1_reviewed_at, second_disbursement_amount, second_disbursement_date, disb2_review_status, disb2_review_note, disb2_reviewed_at, updated_at, epc_business:epc_business_id(trade_name, legal_name, contact_name)")
          .or(PENDING_FILTER)
          .order("updated_at", { ascending: false }),
        supabase()
          .from("epc_business")
          .select("id, epc_display_id, trade_name, legal_name, contact_name, contact_mobile, reviewed_at")
          .eq("admin_review_status", "pending")
          .order("reviewed_at", { ascending: false }),
        supabase()
          .from("epc_documents")
          .select("id, business_id, file_name, created_at, epc_business:business_id(trade_name, legal_name, contact_name, epc_quotation_templates(id, name, ready_at, unlocked, created_at))")
          .eq("category", "custom_quote_sample")
          .order("created_at", { ascending: false }),
      ]);
      const byBiz = new Map<string, Req>();
      for (const d of (samples ?? []) as Row[]) {
        const b = d.epc_business as Row | null;
        const tpl = newest(b?.epc_quotation_templates);
        if (tpl && customState(tpl) === "ready") continue; // ready and unlocked — done
        const cur = byBiz.get(d.business_id) ?? { id: d.business_id as string, name: epcFull(b) || "—", at: d.created_at as string, docs: [] as Row[], tpl };
        cur.docs.push(d);
        byBiz.set(d.business_id, cur);
      }
      setRequests([...byBiz.values()]);
      const loans = (data ?? []) as Row[];
      setError(e ? e.message : e2 ? e2.message : null);
      setRows(loans);
      setItems(loans.flatMap((r) => (["approval", "disb1", "disb2"] as const)
        .filter((k) => r[`${k}_review_status`] === "pending").map((k) => ({ id: r.id as string, k }))));
      setEpcRows((epcs ?? []) as Row[]);
      // The sanction letter + disbursement advice of the waiting approvals (one small query).
      const ids = loans.filter((r) => r.approval_review_status === "pending").map((r) => r.id);
      if (ids.length) {
        const { data: ds } = await supabase().from("user_application_docs")
          .select("id, application_id, category").in("application_id", ids)
          .in("category", ["sanction_letter", "disbursement_advice"]);
        setLetters((ds ?? []) as Row[]);
      }
    })();
  }, [allowed, router, reload]);

  const loaded = rows != null && epcRows != null && requests != null;
  const blinkId = useReturnHighlight(SCROLL_KEY, ROW_KEY, loaded ? (rows?.length ?? 0) + (epcRows?.length ?? 0) + (requests?.length ?? 0) : 0);
  const rowStyle = (rowKey: string) => highlightRowStyle(blinkId === rowKey);
  // Back from a profile: open the section holding that row, then bring the row into view.
  useEffect(() => { if (blinkId) setOpen((o) => ({ ...o, [sectionOf(blinkId)]: true })); }, [blinkId]);
  useEffect(() => { if (blinkId) document.getElementById(`pend-${blinkId}`)?.scrollIntoView({ block: "center" }); }, [blinkId, open]);
  // A link into a profile that remembers the way back (and the row).
  const go = (rowKey: string, href: string, className: string, children: ReactNode) => (
    <Link href={href} className={className} onClick={() => rememberRow(rowKey, href)}>{children}</Link>
  );
  const byId = new Map((rows ?? []).map((r) => [r.id as string, r]));
  const stillPending = items.filter(({ id, k }) => byId.get(id)?.[`${k}_review_status`] === "pending").length;
  // A request counts until its template is made ready (as admin_pending_count, 0122);
  // a ready one waiting for Unlock stays listed, uncounted — the EPC has to pay first.
  const toMakeReady = (requests ?? []).filter((r) => !r.tpl?.ready_at).length;
  const count = stillPending + (epcRows?.length ?? 0) + toMakeReady;
  useEffect(() => { if (loaded) rememberPendingCount(count); }, [loaded, count]);

  async function approveEpc(id: string) {
    if (busy) return;
    setBusy(id + "epc"); setError(null);
    const msg = await approveEpcReview(id);
    setBusy(null);
    if (msg) { setError("Couldn't approve — " + msg); return; }
    invalidate("dash.epcs"); // the console's EPC list shows the lender actions again
    setEpcRows((rs) => (rs ?? []).filter((r) => r.id !== id));
  }

  // Custom template: Ready (stays listed, now with Unlock) / Unlock (leaves the list).
  async function setTemplate(r: Req, patch: { ready_at?: string; unlocked?: boolean }, question: string) {
    if (busy || !r.tpl || !(await askConfirm(question))) return;
    setBusy(r.id + "tpl"); setError(null);
    const msg = await saveCustomTemplate(r.tpl.id, patch);
    setBusy(null);
    if (msg) { setError("Couldn't save — " + msg); return; }
    setRequests((rs) => (rs ?? []).flatMap((x) => (x.id !== r.id ? [x] : patch.unlocked ? [] : [{ ...x, tpl: { ...x.tpl!, ...patch } }])));
  }

  // A decision (approve / send back / undo) — merge what it wrote into the row.
  const decided = (id: string) => (patch: Record<string, string | null>) => {
    invalidateLoanBoards();
    setRows((rs) => (rs ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  if (!allowed) return null;

  const approvals = items.filter((x) => x.k === "approval").map(({ id }) => byId.get(id)).filter(Boolean) as Row[];
  const disbs = items.filter((x) => x.k !== "approval")
    .map(({ id, k }) => ({ r: byId.get(id) as Row, k: k as "disb1" | "disb2" })).filter((x) => x.r);

  const btn = "px-2.5 py-1 border border-line rounded-[8px] text-[12px] font-semibold text-text hover:bg-bg-tint whitespace-nowrap";
  const primary = "px-2.5 py-1 bg-cc-green text-white rounded-[8px] text-[12px] font-semibold hover:bg-cc-green-hover disabled:opacity-60 whitespace-nowrap";
  // A section's dropdown + search controls; typing a search opens it.
  const sec = (k: SectionKey) => ({
    open: !!open[k],
    onToggle: () => setOpen((o) => ({ ...o, [k]: !o[k] })),
    q: find[k] ?? "",
    onQ: (v: string) => { setFind((f) => ({ ...f, [k]: v })); if (v.trim()) setOpen((o) => ({ ...o, [k]: true })); },
  });
  const acts = "flex items-center gap-1.5 justify-end";
  const tabOf = REVIEW_TAB;
  const viewLink = (id: string, k: ReviewItem) => go(id + k, `/admin/app/${id}/view?tab=${tabOf[k]}`, btn, "View");
  const editLink = (id: string, k: ReviewItem, href: string) => go(id + k, href, btn, "Edit");
  const letterBtn = (id: string, category: string, label: string) => {
    const d = letters.find((x) => x.application_id === id && x.category === category);
    return d ? (
      <button type="button" className={btn}
        onClick={() => void getDocumentUrl(d.id).then((url) => { if (url) window.open(url, "_blank", "noopener"); })}>
        {label}
      </button>
    ) : null;
  };
  const decide = (r: Row, k: ReviewItem) => <ReviewBar compact loan={r} item={k} onDecided={decided(r.id)} />;

  return (
    <div className="min-h-screen lg:flex" style={themeStyle("pendings")}>
      <AdminSidebar active="pendings" pendings={loaded ? count : undefined} onPendingsClick={() => setReload((n) => n + 1)} />
      <div className="flex-1 min-w-0">
        <header className="px-4 sm:px-6 py-4 border-b border-line">
          <div className="flex items-center gap-3">
            <SectionMark k="pendings" />
            <h1 className="font-display text-[22px] sm:text-[26px] font-bold" style={{ color: ACCENTS.pendings.color }}>
              Pendings <span className="text-text-muted font-medium text-[15px]">· {count}</span>
            </h1>
          </div>
        </header>

        <main className="px-4 sm:px-6 py-4 space-y-4">
          {error && <p className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-[8px] px-3 py-2">{error}</p>}

          <Section title="EPC pendings" n={epcRows?.length ?? 0} loading={!epcRows} {...sec("epc")}>
            <Table head={["EPC", "EPC ID", "Contact", "Mobile", ""]}>
              {(epcRows ?? []).filter((r) => matches(find.epc, epcFull(r), r.contact_name, r.epc_display_id, r.contact_mobile)).map((r) => (
                <tr key={r.id} id={`pend-epc${r.id}`} className="border-t border-line" style={rowStyle("epc" + r.id)}>
                  <Td wrap>{go("epc" + r.id, `/admin/epc/${r.id}/view`, "font-semibold text-text hover:underline", epcShort(r))}</Td>
                  <Td>{r.epc_display_id || "—"}</Td>
                  <Td wrap>{r.contact_name || "—"}</Td>
                  <Td>{r.contact_mobile ? `+91 ${r.contact_mobile}` : "—"}</Td>
                  <Td>
                    <div className={acts}>
                      {go("epc" + r.id, `/admin/epc/${r.id}/view`, btn, "View")}
                      <button type="button" onClick={() => void approveEpc(r.id)} disabled={busy != null} className={primary}>
                        {busy === r.id + "epc" ? "Approving…" : "Approve"}
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          </Section>

          {/* Custom quotation template: built in code, then Ready here (or on the EPC's profile), then Unlock. */}
          <Section title="Custom template requests" n={toMakeReady} total={requests?.length ?? 0} loading={!requests} {...sec("req")}>
            <Table head={["EPC", "Uploaded", "Sample quotation", ""]}>
              {(requests ?? []).filter((r) => matches(find.req, r.name)).map((r) => (
                <tr key={r.id} id={`pend-req${r.id}`} className="border-t border-line" style={rowStyle("req" + r.id)}>
                  <Td wrap>{go("req" + r.id, `/admin/epc/${r.id}/view`, "font-semibold text-text hover:underline", <span title={r.name}>{shortEpcName(r.name) || "—"}</span>)}</Td>
                  <Td>{fmtDate(r.at)}</Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      {r.docs.map((d, i) => (
                        <button key={d.id} type="button" className={btn} title={d.file_name || undefined}
                          onClick={() => void getDocumentUrl(d.id).then((url) => { if (url) window.open(url, "_blank", "noopener"); })}>
                          {r.docs.length > 1 ? `View ${i + 1}` : "View"}
                        </button>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    <div className={acts}>
                      {go("req" + r.id, `/admin/epc/${r.id}/view`, btn, "Open EPC")}
                      {r.tpl?.ready_at ? (
                        <button type="button" onClick={() => void setTemplate(r, { unlocked: true }, UNLOCK_CONFIRM)} disabled={busy != null} className={primary}>
                          {busy === r.id + "tpl" ? "Saving…" : "Unlock"}
                        </button>
                      ) : (
                        <button type="button" onClick={() => void setTemplate(r, { ready_at: new Date().toISOString() }, READY_CONFIRM)}
                          disabled={busy != null || !r.tpl} title={r.tpl ? undefined : "The template isn't built yet"} className={primary}>
                          {busy === r.id + "tpl" ? "Saving…" : "Ready"}
                        </button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          </Section>

          <Section title="Approval pendings" n={approvals.filter((r) => r.approval_review_status === "pending").length} total={approvals.length} loading={!rows} {...sec("approval")}>
            <Table head={["Applicant", "Loan ID", "EPC", "Lender", "Approved amount", "Tenure", "EMI", "Filled by", ""]}>
              {approvals.filter((r) => matches(find.approval, name(r), r.loan_display_id, epcFull(r.epc_business))).map((r) => (
                <tr key={r.id} id={`pend-${r.id}approval`} className="border-t border-line" style={rowStyle(r.id + "approval")}>
                  <Td wrap>{go(r.id + "approval", `/admin/app/${r.id}/view?tab=approved`, "font-semibold text-text hover:underline", name(r))}</Td>
                  <Td>{r.loan_display_id || "—"}</Td>
                  <Td wrap>{epc(r)}</Td>
                  <Td>{r.approved_lender ? lenderLabelIn(lenders, String(r.approved_lender)) : "—"}</Td>
                  <Td>{fmtRupeesExact(r.sanctioned_amount)}</Td>
                  <Td>{r.approval_details?.approved_tenure_years ? `${r.approval_details.approved_tenure_years} yrs` : "—"}</Td>
                  <Td>{fmtRupeesExact(r.approval_details?.approved_emi)}</Td>
                  <Td>{r.reviewed_by || "—"}</Td>
                  <Td>
                    <div className={acts}>
                      {viewLink(r.id, "approval")}
                      {letterBtn(r.id, "sanction_letter", "Sanction letter")}
                      {letterBtn(r.id, "disbursement_advice", "Advice")}
                      {r.approval_review_status === "pending" && editLink(r.id, "approval", `/admin/app/${r.id}/approval?edit=approval&from=pendings`)}
                      {decide(r, "approval")}
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          </Section>

          <Section title="Disbursement pendings" n={disbs.filter(({ r, k }) => r[`${k}_review_status`] === "pending").length} total={disbs.length} loading={!rows} {...sec("disb")}>
            <Table head={["Applicant", "Loan ID", "EPC", "Tranche", "Amount", "Date", "Sanctioned", ""]}>
              {disbs.filter(({ r }) => matches(find.disb, name(r), r.loan_display_id, epcFull(r.epc_business))).map(({ r, k }) => {
                const first = k === "disb1";
                return (
                  <tr key={r.id + k} id={`pend-${r.id}${k}`} className="border-t border-line" style={rowStyle(r.id + k)}>
                    <Td wrap>{go(r.id + k, `/admin/app/${r.id}/view?tab=${tabOf[k]}`, "font-semibold text-text hover:underline", name(r))}</Td>
                    <Td>{r.loan_display_id || "—"}</Td>
                    <Td wrap>{epc(r)}</Td>
                    <Td>{REVIEW_LABEL[k]}</Td>
                    <Td>{fmtRupeesExact(first ? r.first_disbursement_amount : r.second_disbursement_amount)}</Td>
                    <Td>{fmtDate(first ? r.first_disbursement_date : r.second_disbursement_date)}</Td>
                    <Td>{fmtRupeesExact(r.sanctioned_amount)}</Td>
                    <Td>
                      <div className={acts}>
                        {viewLink(r.id, k)}
                        {r[`${k}_review_status`] === "pending" && editLink(r.id, k, `/admin/app/${r.id}/disbursement`)}
                        {decide(r, k)}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </Table>
          </Section>
        </main>
      </div>
    </div>
  );
}

// A dropdown section: the title bar opens / closes it and holds its search.
// n = still waiting (the red badge); total = rows listed (decided ones stay until reopened).
function Section({ title, n, total = n, loading, open, onToggle, q, onQ, children }: {
  title: string; n: number; total?: number; loading: boolean;
  open: boolean; onToggle: () => void; q: string; onQ: (v: string) => void; children: ReactNode;
}) {
  const idle = loading || total === 0; // nothing to open
  const shown = open && !idle;
  return (
    <section className="bg-white border rounded-card overflow-hidden cc-table-card">
      <div className={["px-4 py-2.5 flex items-center gap-3", shown ? "border-b border-line" : ""].join(" ")}>
        <button type="button" onClick={onToggle} disabled={idle} aria-expanded={shown}
          className="flex-1 min-w-0 flex items-center gap-2 text-left disabled:cursor-default">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            className={["shrink-0 text-text-muted transition-transform", shown ? "rotate-90" : "", idle ? "opacity-0" : ""].join(" ")}>
            <path d="m9 6 6 6-6 6" />
          </svg>
          <h2 className="text-[15px] font-bold" style={{ color: ACCENTS.pendings.color }}>{title}</h2>
          {n > 0 && <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 text-white text-[11px] font-bold leading-5 text-center">{n}</span>}
        </button>
        {idle ? (
          <span className="text-[13px] text-text-muted">{loading ? "Loading…" : "Nothing pending."}</span>
        ) : (
          <div className="relative shrink-0">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input type="search" value={q} onChange={(e) => onQ(e.target.value)} placeholder="Search name" aria-label={`Search ${title}`}
              className="w-40 sm:w-52 border border-line rounded-[8px] pl-8 pr-2.5 py-1.5 text-[13px] bg-white outline-none focus:border-[var(--acc)]" />
          </div>
        )}
      </div>
      {shown && <div className="overflow-x-auto">{children}</div>}
    </section>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <table className="w-full text-[13px] cc-table">
      <thead>
        <tr className="text-left">
          {head.map((h, i) => <th key={i} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {Children.count(children) > 0 ? children : (
          <tr className="border-t border-line"><td colSpan={head.length} className="px-3 py-3 text-text-muted">No match.</td></tr>
        )}
      </tbody>
    </table>
  );
}

// `wrap`: long names (applicant, EPC) go onto a second line instead of widening the table.
const Td = ({ children, wrap }: { children: ReactNode; wrap?: boolean }) => (
  <td className={["px-3 py-2 text-text", wrap ? "" : "whitespace-nowrap"].join(" ")}>
    {wrap ? <div className="min-w-[120px] leading-snug">{children}</div> : children}
  </td>
);
