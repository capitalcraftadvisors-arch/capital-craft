"use client";

// Saved approval details, read-only — what the team sees once they've saved
// (locked until the admin's check) and what the admin checks: the approval table,
// the credit score, and the sanction letter + disbursement advice letter.

import ApprovalDetailsTable, { type ApprovalDetails } from "@/components/ApprovalDetailsTable";
import { getDocumentUrl } from "@/lib/storage";
import { HAction, I, KV, Section } from "@/components/view/ViewKit";

type Loan = Record<string, any>;
type Doc = { id: string; category: string };

export default function ApprovalSummary({ loan, lenderLabel, docs }: {
  loan: Loan;
  lenderLabel?: string | null;
  /** The application's documents — the letters open from here when given. */
  docs?: Doc[];
}) {
  const details = (loan.approval_details ?? {}) as ApprovalDetails;
  const credit = loan.credit_score != null ? String(loan.credit_score) : "None";
  const letter = (category: string) => docs?.find((d) => d.category === category) ?? null;
  const open = async (id: string) => { const url = await getDocumentUrl(id); if (url) window.open(url, "_blank", "noopener"); };

  const docRow = (label: string, category: string, missing: string) => {
    const d = letter(category);
    return (
      <div className="flex items-center justify-between gap-3 py-[5px] text-[14px]">
        <span className="text-[#5a8a76]">{label}</span>
        {d ? <HAction variant="outline" icon={I.eye} onClick={() => void open(d.id)}>View</HAction>
           : <span className="font-medium text-[#0f3d2e]">{missing}</span>}
      </div>
    );
  };

  return (
    <Section title="Approval details" summary={lenderLabel ?? undefined}>
      <ApprovalDetailsTable value={details} readOnly />
      <div className="mt-4 pt-3 border-t border-[#eef1f4] max-w-[520px]">
        <KV k="Credit score" v={loan.credit_ntc ? `${credit} · NTC` : credit} />
        {docs && docRow("Sanction letter", "sanction_letter", loan.sanction_letter_unavailable ? "Not available at filling" : "—")}
        {docs && docRow("Disbursement advice letter", "disbursement_advice", "—")}
      </div>
    </Section>
  );
}
