"use client";

// Pendings — /admin/pendings (main admin only).
//
// The checker side of the maker-checker flow (lib/review): approval details and
// 1st / 2nd disbursements a team member entered wait here for the main admin to
// check, edit if needed, and approve. One query on open; approving updates the
// list locally (no refetch).

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import AdminSidebar from "@/components/AdminSidebar";
import { supabase } from "@/lib/supabase";
import { getBusiness, isMainAdmin } from "@/lib/auth";
import { fmtRupeesExact } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { invalidateLoanBoards } from "@/lib/ops-board";
import { LENDER_LABEL } from "@/components/ApprovalDetailsTable";
import { approveReview, rememberPendingCount, PENDING_FILTER, REVIEW_LABEL, type ReviewItem } from "@/lib/review";

type Row = Record<string, any>;

export default function PendingsPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

const name = (r: Row) => r.aadhaar_name || r.borrower_name || "—";
const epc = (r: Row) => r.epc_business?.trade_name || r.epc_business?.legal_name || r.epc_business?.contact_name || "—";

function Inner() {
  const router = useRouter();
  const allowed = isMainAdmin(getBusiness());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0); // bumped by clicking Pendings in the sidebar

  useEffect(() => {
    if (!allowed) { router.replace("/admin"); return; }
    void (async () => {
      const { data, error: e } = await supabase()
        .from("epc_applications")
        .select("id, loan_display_id, aadhaar_name, borrower_name, approved_lender, sanctioned_amount, approval_details, reviewed_by, approval_review_status, first_disbursement_amount, first_disbursement_date, disb1_review_status, second_disbursement_amount, second_disbursement_date, disb2_review_status, updated_at, epc_business:epc_business_id(trade_name, legal_name, contact_name)")
        .or(PENDING_FILTER)
        .order("updated_at", { ascending: false });
      setError(e ? e.message : null);
      setRows((data ?? []) as Row[]);
    })();
  }, [allowed, router, reload]);

  const count = rows?.length ?? 0;
  useEffect(() => { if (rows) rememberPendingCount(rows.length); }, [rows]);

  async function approve(id: string, item: ReviewItem) {
    const key = id + item;
    if (busy) return;
    setBusy(key); setError(null);
    const msg = await approveReview(id, item);
    setBusy(null);
    if (msg) { setError("Couldn't approve — " + msg); return; }
    invalidateLoanBoards();
    setRows((rs) => (rs ?? [])
      .map((r) => (r.id === id ? { ...r, [`${item}_review_status`]: "approved" } : r))
      .filter((r) => r.approval_review_status === "pending" || r.disb1_review_status === "pending" || r.disb2_review_status === "pending"));
  }

  if (!allowed) return null;

  const approvals = (rows ?? []).filter((r) => r.approval_review_status === "pending");
  const disbs = (rows ?? []).flatMap((r) => (["disb1", "disb2"] as const)
    .filter((k) => r[`${k}_review_status`] === "pending")
    .map((k) => ({ r, k })));

  const approveBtn = (id: string, item: ReviewItem) => (
    <button type="button" onClick={() => void approve(id, item)} disabled={busy != null}
      className="px-3 py-1.5 bg-[#178a5c] text-white rounded text-[12px] font-semibold hover:bg-[#12734c] disabled:opacity-60">
      {busy === id + item ? "Approving…" : "Approve"}
    </button>
  );
  const editLink = (href: string) => (
    <Link href={href as any} className="px-3 py-1.5 border border-line rounded text-[12px] font-semibold text-text hover:bg-bg-tint">Edit</Link>
  );

  return (
    <div className="min-h-screen bg-bg-soft md:flex">
      <AdminSidebar active="pendings" pendings={rows ? count : undefined} onPendingsClick={() => setReload((n) => n + 1)} />
      <div className="flex-1 min-w-0">
        <header className="px-4 sm:px-6 py-5 border-b border-line bg-white">
          <div className="flex items-center gap-2.5">
            <span className="inline-block w-1.5 h-7 rounded-full" style={{ backgroundColor: "#b91c1c" }} />
            <h1 className="font-display text-[22px] sm:text-[26px] font-bold text-text">
              Pendings <span className="text-text-muted font-medium text-[15px]">· {count}</span>
            </h1>
          </div>
        </header>

        <main className="px-4 sm:px-6 py-5 space-y-6">
          {error && <p className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-[8px] px-3 py-2">{error}</p>}

          <Section title="Approval pendings" n={approvals.length} loading={!rows}>
            <Table head={["Applicant", "Loan ID", "EPC", "Lender", "Approved amount", "Tenure", "EMI", "Filled by", ""]}>
              {approvals.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <Td><Link href={`/admin/app/${r.id}/view` as any} className="font-semibold text-text hover:underline">{name(r)}</Link></Td>
                  <Td>{r.loan_display_id || "—"}</Td>
                  <Td>{epc(r)}</Td>
                  <Td>{LENDER_LABEL[String(r.approved_lender)] ?? r.approved_lender ?? "—"}</Td>
                  <Td>{fmtRupeesExact(r.sanctioned_amount)}</Td>
                  <Td>{r.approval_details?.approved_tenure_years ? `${r.approval_details.approved_tenure_years} yrs` : "—"}</Td>
                  <Td>{fmtRupeesExact(r.approval_details?.approved_emi)}</Td>
                  <Td>{r.reviewed_by || "—"}</Td>
                  <Td>
                    <div className="flex items-center gap-2 justify-end">
                      {editLink(`/admin/app/${r.id}/approval?edit=approval&from=pendings`)}
                      {approveBtn(r.id, "approval")}
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          </Section>

          <Section title="Disbursement pendings" n={disbs.length} loading={!rows}>
            <Table head={["Applicant", "Loan ID", "EPC", "Tranche", "Amount", "Date", "Sanctioned", ""]}>
              {disbs.map(({ r, k }) => {
                const first = k === "disb1";
                return (
                  <tr key={r.id + k} className="border-t border-line">
                    <Td><Link href={`/admin/app/${r.id}/view` as any} className="font-semibold text-text hover:underline">{name(r)}</Link></Td>
                    <Td>{r.loan_display_id || "—"}</Td>
                    <Td>{epc(r)}</Td>
                    <Td>{REVIEW_LABEL[k]}</Td>
                    <Td>{fmtRupeesExact(first ? r.first_disbursement_amount : r.second_disbursement_amount)}</Td>
                    <Td>{fmtDate(first ? r.first_disbursement_date : r.second_disbursement_date)}</Td>
                    <Td>{fmtRupeesExact(r.sanctioned_amount)}</Td>
                    <Td>
                      <div className="flex items-center gap-2 justify-end">
                        {editLink(`/admin/app/${r.id}/disbursement`)}
                        {approveBtn(r.id, k)}
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

function Section({ title, n, loading, children }: { title: string; n: number; loading: boolean; children: ReactNode }) {
  return (
    <section className="bg-white border border-line rounded-xl">
      <div className="px-4 py-3 border-b border-line flex items-center gap-2">
        <h2 className="text-[15px] font-bold text-text">{title}</h2>
        {n > 0 && <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 text-white text-[11px] font-bold leading-5 text-center">{n}</span>}
      </div>
      {loading ? (
        <p className="px-4 py-6 text-[13px] text-text-muted">Loading…</p>
      ) : n === 0 ? (
        <p className="px-4 py-6 text-[13px] text-text-muted">Nothing pending.</p>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </section>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-left text-text-muted">
          {head.map((h, i) => <th key={i} className="px-4 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

const Td = ({ children }: { children: ReactNode }) => <td className="px-4 py-2.5 whitespace-nowrap text-text">{children}</td>;
