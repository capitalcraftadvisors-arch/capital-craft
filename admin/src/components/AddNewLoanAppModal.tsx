"use client";

// Admin-only "Add New Loan Application" flow.
//
// UX:
//   1. Admin clicks "+ Add New Loan Application" on the Loan
//      applications tab.
//   2. Modal shows a dropdown of EPCs that have has_lender_approval=true
//      (i.e. at least one lender has ticked Approved on epc_lender_status).
//      EPCs without any approval do NOT appear.
//   3. On confirm → POST /api/admin/create-loan-app { epc_business_id }
//      creates a fresh draft row, then the modal routes to
//      /admin/app/{id}/step-1 where the admin fills the rest.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { getToken } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type Props = {
  open: boolean;
  onClose: () => void;
};

type EpcOption = {
  id: string;
  display_id: string | null;
  contact_name: string | null;
  trade_name: string | null;
  legal_name: string | null;
};

function bestName(e: EpcOption): string {
  return e.trade_name || e.legal_name || e.contact_name || "(unnamed)";
}

export default function AddNewLoanAppModal({ open, onClose }: Props) {
  const router = useRouter();
  const [epcs, setEpcs] = useState<EpcOption[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSelected("");
    setLoading(true);
    void (async () => {
      const { data, error: qErr } = await supabase()
        .from("epc_business")
        .select("id, epc_display_id, contact_name, trade_name, legal_name")
        .eq("has_lender_approval", true)
        .neq("business_type", "admin")
        .order("trade_name", { ascending: true, nullsFirst: false })
        .order("legal_name", { ascending: true, nullsFirst: false });
      if (qErr) {
        setError(qErr.message);
      } else {
        setEpcs((data ?? []).map((r) => ({
          id: r.id,
          display_id: r.epc_display_id,
          contact_name: r.contact_name,
          trade_name: r.trade_name,
          legal_name: r.legal_name,
        })));
      }
      setLoading(false);
    })();
  }, [open]);

  const sortedEpcs = useMemo(
    () => [...epcs].sort((a, b) => bestName(a).localeCompare(bestName(b))),
    [epcs],
  );

  if (!open) return null;

  function close() {
    setError(null);
    setSelected("");
    setBusy(false);
    onClose();
  }

  async function submit() {
    if (!selected) { setError("Pick an EPC to continue."); return; }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/create-loan-app", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken() ?? ""}`,
        },
        body: JSON.stringify({ epc_business_id: selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setError(data?.error || `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      onClose();
      router.push(`/admin/app/${data.application.id}/step-1` as any);
    } catch (e) {
      setError((e as Error)?.message || "Network error.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={busy ? undefined : close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-lg shadow-lg p-6"
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-display font-semibold text-[18px] text-text">Add new loan application</h3>
            <p className="text-[12px] text-text-mid mt-0.5">
              Pick the EPC partner. Only EPCs approved by at least one lender appear here.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="text-[18px] text-text-muted hover:text-text leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block mb-1.5 text-[13px] font-medium text-text-mid">
              EPC partner
            </label>
            {loading ? (
              <p className="text-[13px] text-text-muted py-2">Loading eligible EPCs…</p>
            ) : epcs.length === 0 ? (
              <div className="p-3 rounded-input bg-bg-tint border border-line text-[13px] text-text-mid">
                No EPC has been approved by any lender yet. Tick &ldquo;Approved&rdquo; on
                an EPC in the list before starting a loan application.
              </div>
            ) : (
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                disabled={busy}
                className="w-full rounded-input border border-line bg-white px-3.5 py-3 text-[15px] outline-none focus:border-blue"
              >
                <option value="">Select…</option>
                {sortedEpcs.map((e) => (
                  <option key={e.id} value={e.id}>
                    {bestName(e)}{e.display_id ? ` — ${e.display_id}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-input bg-red-50 border border-red-200 text-[12px] text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={submit}
            loading={busy}
            disabled={loading || epcs.length === 0 || !selected}
          >
            Create draft &amp; continue
          </Button>
        </div>
      </div>
    </div>
  );
}
