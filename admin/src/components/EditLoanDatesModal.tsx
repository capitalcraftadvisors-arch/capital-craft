"use client";

// Main admin: correct a loan application's dates (profile ⋮ → Edit dates) —
// for files keyed in after the fact from the old Excel sheets. Created on,
// approval date and the 1st / 2nd disbursement dates; only the dates that apply
// to the file are shown. A timestamp keeps its time of day, only the day moves.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import DateField from "@/components/ui/DateField";
import { fmtDate, localIsoDate, withLocalDate } from "@/lib/dates";
import { logLoanActivity } from "@/lib/loanAudit";
import { invalidateLoanBoards } from "@/lib/ops-board";

type Loan = Record<string, any>;
type Key = "created" | "approval" | "first" | "second";

const LABEL: Record<Key, string> = {
  created: "Created on",
  approval: "Approval date",
  first: "1st disbursement date",
  second: "2nd disbursement date",
};

function initial(loan: Loan): Partial<Record<Key, string>> {
  const v: Partial<Record<Key, string>> = { created: localIsoDate(loan.created_at) };
  const approval = loan.approval_details?.approval_date || localIsoDate(loan.approved_at);
  if (approval) v.approval = approval;
  if (loan.first_disbursement_amount != null || loan.first_disbursement_date) v.first = localIsoDate(loan.first_disbursement_date);
  if (loan.second_disbursement_amount != null || loan.second_disbursement_date) v.second = localIsoDate(loan.second_disbursement_date);
  return v;
}

export default function EditLoanDatesModal({
  open, loan, onClose, onSaved,
}: {
  open: boolean;
  loan: Loan;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [init, setInit] = useState<Partial<Record<Key, string>>>({});
  const [val, setVal] = useState<Partial<Record<Key, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const v = initial(loan);
    setInit(v); setVal(v); setError(null);
  }, [open, loan]);

  if (!open) return null;

  const keys = (Object.keys(LABEL) as Key[]).filter((k) => k in init);
  const today = localIsoDate(new Date());

  async function save() {
    if (busy) return;
    for (const k of keys) {
      if (!val[k]) { setError(`${LABEL[k]} is required.`); return; }
      if (val[k]! > today) { setError(`${LABEL[k]} can't be in the future.`); return; }
    }
    // Dates must run in order: created → approval → 1st → 2nd disbursement.
    for (let i = 1; i < keys.length; i++) {
      if (val[keys[i]]! < val[keys[i - 1]]!) { setError(`${LABEL[keys[i]]} can't be before ${LABEL[keys[i - 1]].toLowerCase()}.`); return; }
    }
    const changed = keys.filter((k) => val[k] !== init[k]);
    if (!changed.length) { onClose(); return; }

    const patch: Loan = {};
    if (changed.includes("created")) patch.created_at = withLocalDate(loan.created_at, val.created!);
    if (changed.includes("approval")) {
      patch.approved_at = withLocalDate(loan.approved_at, val.approval!);
      patch.approval_details = { ...(loan.approval_details ?? {}), approval_date: val.approval };
    }
    if (changed.includes("first")) patch.first_disbursement_date = val.first;
    if (changed.includes("second")) patch.second_disbursement_date = val.second;

    setBusy(true); setError(null);
    const { error: e } = await supabase().from("epc_applications").update(patch).eq("id", loan.id);
    if (e) { setError("Couldn't save — " + e.message); setBusy(false); return; }

    // The approving lender's own record carries the approval date too (Lender status box).
    if (changed.includes("approval") && loan.approved_lender) {
      const { data: lr } = await supabase().from("loan_application_lenders")
        .select("id, approval_details")
        .eq("application_id", loan.id).eq("lender_key", loan.approved_lender).not("approved_at", "is", null)
        .maybeSingle();
      if (lr) {
        await supabase().from("loan_application_lenders").update({
          approved_at: patch.approved_at,
          approval_details: { ...((lr as Loan).approval_details ?? {}), approval_date: val.approval },
        }).eq("id", (lr as Loan).id);
      }
    }

    await logLoanActivity(loan.id, "field_edit", {
      detail: "Dates edited — " + changed.map((k) => `${LABEL[k]} ${fmtDate(init[k])} → ${fmtDate(val[k])}`).join("; "),
    });
    invalidateLoanBoards(); // period filters / KPIs / board read these dates
    setBusy(false);
    onSaved();
  }

  const inputCls = "w-full border border-[#cdeadd] rounded-[8px] px-3 py-2.5 text-[14px] focus:border-[#185fa5] outline-none bg-white";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => { if (!busy) onClose(); }}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-white rounded-lg shadow-lg p-6">
        <h3 className="font-semibold text-[18px] text-[#0f3d2e]">Edit dates</h3>
        <div className="mt-4 space-y-3">
          {keys.map((k) => (
            <div key={k}>
              <p className="text-[12px] text-[#5a8a76] mb-1">{LABEL[k]}</p>
              <DateField className={inputCls} value={val[k] ?? ""} max={today}
                onChange={(iso) => setVal((v) => ({ ...v, [k]: iso }))} ariaLabel={LABEL[k]} />
            </div>
          ))}
        </div>
        {error && <p className="mt-3 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-[8px] px-3 py-2">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="text-[13px] font-semibold px-3 py-2 rounded-[8px] border border-[#cdeadd] bg-white text-[#0f3d2e] hover:bg-[#f0faf5] disabled:opacity-60">
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={busy}
            className="text-[13px] font-semibold px-3 py-2 rounded-[8px] bg-[#178a5c] text-white hover:bg-[#12734c] disabled:opacity-60">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
