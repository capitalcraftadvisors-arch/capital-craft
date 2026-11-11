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

import { useEffect, useState, type ReactNode } from "react";
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

type Row = Record<string, any>;

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
  // EPCs whose sample quotation waits for a ready custom template (0122).
  const [requests, setRequests] = useState<Array<{ id: string; name: string; at: string; docs: Row[] }> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0); // bumped by clicking Pendings in the sidebar

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
          .select("id, business_id, file_name, created_at, epc_business:business_id(trade_name, legal_name, contact_name, epc_quotation_templates(ready_at))")
          .eq("category", "custom_quote_sample")
          .order("created_at", { ascending: false }),
      ]);
      const byBiz = new Map<string, { id: string; name: string; at: string; docs: Row[] }>();
      for (const d of (samples ?? []) as Row[]) {
        const b = d.epc_business as Row | null;
        if ((b?.epc_quotation_templates ?? []).some((t: Row) => t.ready_at)) continue; // already ready
        const cur = byBiz.get(d.business_id) ?? { id: d.business_id as string, name: epcFull(b) || "—", at: d.created_at as string, docs: [] as Row[] };
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
  const byId = new Map((rows ?? []).map((r) => [r.id as string, r]));
  const stillPending = items.filter(({ id, k }) => byId.get(id)?.[`${k}_review_status`] === "pending").length;
  const count = stillPending + (epcRows?.length ?? 0) + (requests?.length ?? 0);
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
  const acts = "flex items-center gap-1.5 justify-end";
  const tabOf = REVIEW_TAB;
  const viewLink = (id: string, k: ReviewItem) => (
    <Link href={`/admin/app/${id}/view?tab=${tabOf[k]}` as any} className={btn}>View</Link>
  );
  const editLink = (href: string) => <Link href={href as any} className={btn}>Edit</Link>;
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

          <Section title="EPC pendings" n={epcRows?.length ?? 0} loading={!epcRows}>
            <Table head={["EPC", "EPC ID", "Contact", "Mobile", ""]}>
              {(epcRows ?? []).map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <Td wrap><Link href={`/admin/epc/${r.id}/view` as any} className="font-semibold text-text hover:underline">{epcShort(r)}</Link></Td>
                  <Td>{r.epc_display_id || "—"}</Td>
                  <Td wrap>{r.contact_name || "—"}</Td>
                  <Td>{r.contact_mobile ? `+91 ${r.contact_mobile}` : "—"}</Td>
                  <Td>
                    <div className={acts}>
                      <Link href={`/admin/epc/${r.id}/view` as any} className={btn}>View</Link>
                      <button type="button" onClick={() => void approveEpc(r.id)} disabled={busy != null}
                        className="px-2.5 py-1 bg-[#178a5c] text-white rounded-[8px] text-[12px] font-semibold hover:bg-[#12734c] disabled:opacity-60 whitespace-nowrap">
                        {busy === r.id + "epc" ? "Approving…" : "Approve"}
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          </Section>

          {/* Custom quotation template: build it, then Mark ready on the EPC's profile. */}
          <Section title="Custom template requests" n={requests?.length ?? 0} loading={!requests}>
            <Table head={["EPC", "Uploaded", "Sample quotation", ""]}>
              {(requests ?? []).map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <Td wrap><Link href={`/admin/epc/${r.id}/view` as any} className="font-semibold text-text hover:underline"><span title={r.name}>{shortEpcName(r.name) || "—"}</span></Link></Td>
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
                  <Td><div className={acts}><Link href={`/admin/epc/${r.id}/view` as any} className={btn}>Open EPC</Link></div></Td>
                </tr>
              ))}
            </Table>
          </Section>

          <Section title="Approval pendings" n={approvals.filter((r) => r.approval_review_status === "pending").length} total={approvals.length} loading={!rows}>
            <Table head={["Applicant", "Loan ID", "EPC", "Lender", "Approved amount", "Tenure", "EMI", "Filled by", ""]}>
              {approvals.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <Td wrap><Link href={`/admin/app/${r.id}/view?tab=approved` as any} className="font-semibold text-text hover:underline">{name(r)}</Link></Td>
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
                      {r.approval_review_status === "pending" && editLink(`/admin/app/${r.id}/approval?edit=approval&from=pendings`)}
                      {decide(r, "approval")}
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          </Section>

          <Section title="Disbursement pendings" n={disbs.filter(({ r, k }) => r[`${k}_review_status`] === "pending").length} total={disbs.length} loading={!rows}>
            <Table head={["Applicant", "Loan ID", "EPC", "Tranche", "Amount", "Date", "Sanctioned", ""]}>
              {disbs.map(({ r, k }) => {
                const first = k === "disb1";
                return (
                  <tr key={r.id + k} className="border-t border-line">
                    <Td wrap><Link href={`/admin/app/${r.id}/view?tab=${tabOf[k]}` as any} className="font-semibold text-text hover:underline">{name(r)}</Link></Td>
                    <Td>{r.loan_display_id || "—"}</Td>
                    <Td wrap>{epc(r)}</Td>
                    <Td>{REVIEW_LABEL[k]}</Td>
                    <Td>{fmtRupeesExact(first ? r.first_disbursement_amount : r.second_disbursement_amount)}</Td>
                    <Td>{fmtDate(first ? r.first_disbursement_date : r.second_disbursement_date)}</Td>
                    <Td>{fmtRupeesExact(r.sanctioned_amount)}</Td>
                    <Td>
                      <div className={acts}>
                        {viewLink(r.id, k)}
                        {r[`${k}_review_status`] === "pending" && editLink(`/admin/app/${r.id}/disbursement`)}
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

// n = still waiting (the red badge); total = rows listed (decided ones stay until reopened).
function Section({ title, n, total = n, loading, children }: { title: string; n: number; total?: number; loading: boolean; children: ReactNode }) {
  return (
    <section className="bg-white border rounded-card overflow-hidden cc-table-card">
      {/* Loading / empty: one line in the title bar, so the page fits without scrolling. */}
      <div className={["px-4 py-2.5 flex items-center gap-2", loading || total === 0 ? "" : "border-b border-line"].join(" ")}>
        <h2 className="text-[15px] font-bold" style={{ color: ACCENTS.pendings.color }}>{title}</h2>
        {n > 0 && <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 text-white text-[11px] font-bold leading-5 text-center">{n}</span>}
        {(loading || total === 0) && <span className="ml-auto text-[13px] text-text-muted">{loading ? "Loading…" : "Nothing pending."}</span>}
      </div>
      {!loading && total > 0 && <div className="overflow-x-auto">{children}</div>}
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
      <tbody>{children}</tbody>
    </table>
  );
}

// `wrap`: long names (applicant, EPC) go onto a second line instead of widening the table.
const Td = ({ children, wrap }: { children: ReactNode; wrap?: boolean }) => (
  <td className={["px-3 py-2 text-text", wrap ? "" : "whitespace-nowrap"].join(" ")}>
    {wrap ? <div className="min-w-[120px] leading-snug">{children}</div> : children}
  </td>
);
