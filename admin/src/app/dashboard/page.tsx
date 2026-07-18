"use client";

// EPC portal — the EPC's OWN loan applications.
//
// SCOPING: the query runs with the EPC's JWT; the "own_applications"
// RLS policy (0002: epc_business_id = jwt.business_id) means Postgres
// only ever returns THIS EPC's rows — cross-EPC access is impossible
// at the database layer, regardless of what the client requests.
//
// STATUS: shows the LENDER'S loan outcome, mapped to three buckets:
//     approved / sent_to_nbfc / disbursed  →  Approved by lender
//     rejected                             →  Rejected by lender
//     everything else                      →  Under Review
// This is the loan application's own pipeline outcome — distinct from
// the internal admin EPC-profile status, which stays hidden from EPCs.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { logout, getBusiness, getToken, loanAccess, insuranceAccess } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { lenderOutcome, OUTCOME_LABEL, OUTCOME_PILL } from "@/lib/loan-status";
import {
  deadlineState, DEADLINE_PILL, fmtRupees, fmtDateShort,
  displayAmount as amountFor,
} from "@/lib/disbursement";
import { policyValidityParts, VALIDITY_TEXT } from "@/lib/insurance-validity";

type AppRow = {
  id: string;
  borrower_name: string | null;
  aadhaar_name: string | null;
  loan_display_id: string | null;
  loan_amount: number | null;
  loan_amount_required: number | null;
  project_size: number | null;
  project_size_unit: string | null;
  // Disbursement (migration 0044) — read-only for EPCs.
  sanctioned_amount: number | null;
  first_disbursement_amount: number | null;
  first_disbursement_date: string | null;
  status: string;
  created_at: string;
};

export default function DashboardPage() {
  return (
    <AuthGuard allow={["approved"]}>
      <DashboardInner />
    </AuthGuard>
  );
}

// The EPC's own insurance applications. RLS (own_insurance) scopes this to the
// logged-in EPC server-side — the query carries no business filter of its own.
type InsRow = {
  id: string;
  insurance_display_id: string | null;
  aadhaar_name: string | null;
  sum_insured: number | null;
  invoice_confirmed_amount: number | null;
  insurance_partner: string | null;
  policy_from_date: string | null;
  policy_to_date: string | null;
  status: string;
  created_at: string;
};

const INS_STATUS_LABEL: Record<string, string> = {
  draft: "Draft", under_review: "Under Review", issued: "Issued", rejected: "Rejected", hold: "Hold",
};
const INS_STATUS_PILL: Record<string, string> = {
  draft: "bg-[#eef1f0] text-[#5a8a76]",
  under_review: "bg-[#fef0d6] text-[#854f0b]",
  issued: "bg-[#e6f6ee] text-[#178a5c]",
  rejected: "bg-red-50 text-red-700",
  hold: "bg-[#dceffb] text-[#185fa5]",
};

function DashboardInner() {
  const router = useRouter();
  const [rows, setRows] = useState<AppRow[]>([]);
  const [insRows, setInsRows] = useState<InsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [insBusy, setInsBusy] = useState(false);

  const me = getBusiness();
  const canLoan = loanAccess(me);
  const canInsurance = insuranceAccess(me);

  // "Apply for Insurance" → create (or resume) a draft insurance application,
  // then jump to Step 1. Server enforces service_type in (insurance, both).
  async function startInsurance() {
    if (insBusy) return;
    setInsBusy(true);
    try {
      const res = await fetch("/api/epc/insurance/create", {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        alert("Couldn't start the insurance application: " + (data?.error || `HTTP ${res.status}`));
        return;
      }
      router.push(`/dashboard/insurance/${data.application.id}/step-1` as any);
    } catch (e) {
      alert("Network error: " + (e as Error).message);
    } finally {
      setInsBusy(false);
    }
  }

  useEffect(() => {
    (async () => {
      // RLS scopes this to the logged-in EPC's applications only.
      const { data } = await supabase()
        .from("epc_applications")
        .select(
          "id, borrower_name, aadhaar_name, loan_display_id, " +
          "loan_amount, loan_amount_required, project_size, project_size_unit, " +
          "sanctioned_amount, first_disbursement_amount, first_disbursement_date, " +
          "status, created_at",
        )
        .order("created_at", { ascending: false });
      setRows((data ?? []) as unknown as AppRow[]);

      // Insurance applications — RLS scopes to this EPC only.
      const { data: ins } = await supabase()
        .from("insurance_applications")
        .select(
          "id, insurance_display_id, aadhaar_name, sum_insured, invoice_confirmed_amount, " +
          "insurance_partner, policy_from_date, policy_to_date, status, created_at",
        )
        .order("created_at", { ascending: false });
      setInsRows((ins ?? []) as unknown as InsRow[]);
      setLoading(false);
    })();
  }, []);

  function borrower(r: AppRow): string {
    return r.borrower_name || r.aadhaar_name || "—";
  }
  // Approved → the SANCTIONED amount; otherwise what was applied for.
  function amount(r: AppRow): string {
    return fmtRupees(amountFor(r));
  }
  function capacity(r: AppRow): string {
    if (r.project_size == null) return "—";
    return `${r.project_size} ${(r.project_size_unit ?? "kw").toUpperCase()}`;
  }
  function loginDateTime(r: AppRow): string {
    return new Date(r.created_at).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white">
        <div className="max-w-container mx-auto px-7 h-16 flex items-center justify-between">
          <a href="/" className="font-display font-bold text-[20px] grad-text">Capital Craft</a>
          <button onClick={() => { logout(); router.replace("/login"); }} className="text-[13px] text-text-muted hover:text-text">
            Log out
          </button>
        </div>
      </header>

      <section className="max-w-container mx-auto px-5 sm:px-7 py-10">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="font-display text-[26px] sm:text-[30px] font-bold text-[#0f3d2e]">
              {canLoan ? "Your loan applications" : "Your applications"}
            </h1>
            <p className="text-text-mid mt-1">
              {canLoan
                ? "Applications you’ve submitted and where each one stands with the lender."
                : "Apply for insurance for your installed plants."}
            </p>
          </div>
          {/* Buttons follow the admin's Service selection + lender approval. */}
          <div className="flex gap-3 flex-wrap">
            {canInsurance && (
              <Button variant="primary" onClick={() => void startInsurance()} loading={insBusy}>
                Apply for Insurance
              </Button>
            )}
            {canLoan && (
              <Button variant={canInsurance ? "outline" : "primary"} onClick={() => router.push("/dashboard/apply" as any)}>
                Apply for Loan
              </Button>
            )}
          </div>
        </div>

        {/* The loan table is only meaningful for EPCs with loan access. */}
        {canLoan && (
        <Card className="overflow-hidden">
          <table className="w-full text-[14px]">
            <thead className="bg-bg-soft border-b border-line">
              <tr className="text-left text-text-muted">
                <th className="px-5 py-3 font-medium">Borrower</th>
                <th className="px-5 py-3 font-medium">Loan amount</th>
                <th className="px-5 py-3 font-medium">Plant capacity</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Disbursement</th>
                <th className="px-5 py-3 font-medium">Days remaining</th>
                <th className="px-5 py-3 font-medium">Login date &amp; time</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-text-muted">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-text-muted">
                  No applications yet. Click <span className="text-text font-semibold">Apply for Loan</span> to start one.
                </td></tr>
              ) : rows.map((r) => {
                const outcome = lenderOutcome(r.status);
                const approved = r.status === "approved";
                const dl = deadlineState(r.first_disbursement_date);
                // An approved application opens straight onto its disbursement
                // section — that's where the EPC's remaining work lives.
                const openDisbursement = () => router.push(`/dashboard/${r.id}/disbursement` as any);
                return (
                  <tr
                    key={r.id}
                    onClick={approved ? openDisbursement : undefined}
                    className={[
                      "border-b border-line transition-colors",
                      approved ? "cursor-pointer hover:bg-[#f0faf5]" : "hover:bg-[#f0faf5]",
                    ].join(" ")}
                  >
                    <td className="px-5 py-4">
                      <div className="font-semibold text-text">{borrower(r)}</div>
                      {r.loan_display_id && (
                        <div className="text-[11px] font-mono text-[#185fa5] mt-0.5">{r.loan_display_id}</div>
                      )}
                    </td>
                    <td className="px-5 py-4 font-semibold text-[#0f3d2e]">{amount(r)}</td>
                    <td className="px-5 py-4">{capacity(r)}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide ${OUTCOME_PILL[outcome]}`}>
                        {OUTCOME_LABEL[outcome]}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {!approved ? (
                        <span className="text-text-muted">—</span>
                      ) : r.first_disbursement_amount != null ? (
                        <>
                          <div className="font-semibold text-[#0f3d2e]">{fmtRupees(r.first_disbursement_amount)}</div>
                          <div className="text-[11px] text-text-muted mt-0.5">{fmtDateShort(r.first_disbursement_date)}</div>
                        </>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {!approved ? (
                        <span className="text-text-muted">—</span>
                      ) : (
                        <span className={["inline-block px-2 py-1 rounded-[6px] text-[11px] font-semibold whitespace-nowrap", DEADLINE_PILL[dl.tone]].join(" ")}>
                          {dl.label}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-text-muted whitespace-nowrap">{loginDateTime(r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        )}

        {/* ── Insurance applications — this EPC's own, RLS-scoped. ── */}
        {canInsurance && (
          <div className={canLoan ? "mt-10" : ""}>
            <h2 className="font-display text-[20px] sm:text-[22px] font-bold text-[#0f3d2e] mb-1">
              Your insurance applications
            </h2>
            <p className="text-text-mid mb-4 text-[14px]">
              Plants you&rsquo;ve submitted for insurance and where each one stands.
            </p>
            <Card className="overflow-hidden">
              <table className="w-full text-[14px]">
                <thead className="bg-bg-soft border-b border-line">
                  <tr className="text-left text-text-muted">
                    <th className="px-5 py-3 font-medium">Insured name</th>
                    <th className="px-5 py-3 font-medium">Sum insured</th>
                    <th className="px-5 py-3 font-medium">Insurance partner</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Policy Validity</th>
                    <th className="px-5 py-3 font-medium">Created on</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-text-muted">Loading…</td></tr>
                  ) : insRows.length === 0 ? (
                    <tr><td colSpan={6} className="px-5 py-12 text-center text-text-muted">
                      No insurance applications yet. Click <span className="text-text font-semibold">Apply for Insurance</span> to start one.
                    </td></tr>
                  ) : insRows.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => router.push(`/dashboard/insurance/${r.id}/step-1` as any)}
                      className="border-b border-line cursor-pointer hover:bg-[#f0faf5] transition-colors"
                    >
                      <td className="px-5 py-4">
                        <div className="text-[15px] font-semibold text-text">{r.aadhaar_name || "—"}</div>
                        {r.insurance_display_id && (
                          <div className="text-[12px] font-mono text-[#185fa5] mt-0.5">{r.insurance_display_id}</div>
                        )}
                      </td>
                      <td className="px-5 py-4 font-semibold text-[#0f3d2e]">
                        {fmtRupees(r.sum_insured ?? r.invoice_confirmed_amount)}
                      </td>
                      <td className="px-5 py-4">{r.insurance_partner || "—"}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide ${INS_STATUS_PILL[r.status] ?? INS_STATUS_PILL.draft}`}>
                          {INS_STATUS_LABEL[r.status] ?? r.status}
                        </span>
                      </td>
                      {/* Coverage dates + days left — same as the admin table. */}
                      <td className="px-5 py-4">
                        {(() => {
                          const v = policyValidityParts(r.policy_from_date, r.policy_to_date);
                          return v
                            ? <span className={`text-[12px] font-medium ${VALIDITY_TEXT[v.tone]}`}>{v.text}</span>
                            : <span className="text-text-muted">—</span>;
                        })()}
                      </td>
                      <td className="px-5 py-4 text-text-muted whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString("en-IN", {
                          day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}
      </section>
    </main>
  );
}
