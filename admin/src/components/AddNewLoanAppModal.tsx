"use client";

// Admin-only "Add New Loan Application" flow.
//
// UX:
//   1. Admin clicks "+ New Applicant" on the Loan applications tab.
//   2. A CHOOSER appears — two ways to create the application:
//        • AI chat concierge  → /admin/app/intake (guided chat that builds the
//          whole profile from documents + a few questions).
//        • Classic form       → pick an approved EPC, then the step-by-step
//          wizard (the original flow, unchanged).
//   3. Classic: dropdown shows EPCs with has_lender_approval=true. On confirm →
//      POST /api/admin/create-loan-app { epc_business_id } → routes to
//      /admin/app/{id}/step-1.

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
  const [mode, setMode] = useState<"choose" | "classic">("choose");
  const [epcs, setEpcs] = useState<EpcOption[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to the chooser every time the modal opens.
  useEffect(() => {
    if (!open) return;
    setMode("choose");
    setError(null);
    setSelected("");
  }, [open]);

  // Load EPCs only when the classic form is chosen.
  useEffect(() => {
    if (!open || mode !== "classic") return;
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
  }, [open, mode]);

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

  function startChat() {
    onClose();
    router.push("/admin/app/intake" as any);
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
              {mode === "choose" ? "Choose how you'd like to create this application." : "Pick the EPC partner. Only EPCs approved by at least one lender appear here."}
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

        {mode === "choose" ? (
          <div className="grid gap-3">
            <button
              type="button"
              onClick={startChat}
              className="text-left rounded-xl border border-line hover:border-[#178a5c] hover:bg-[#f7fcf9] transition p-4 flex items-center gap-3"
            >
              <span className="w-10 h-10 rounded-full bg-gradient-to-br from-[#2fbd82] to-[#0f3d2e] text-white grid place-items-center text-[16px] shrink-0">💬</span>
              <span className="text-[15px] font-semibold text-text">Application maker</span>
            </button>
            <button
              type="button"
              onClick={() => setMode("classic")}
              className="text-left rounded-xl border border-line hover:border-[#178a5c] hover:bg-[#f7fcf9] transition p-4 flex items-center gap-3"
            >
              <span className="w-10 h-10 rounded-full bg-bg-soft text-text grid place-items-center text-[16px] shrink-0">📝</span>
              <span className="text-[15px] font-semibold text-text">Classic form</span>
            </button>
          </div>
        ) : (
          <>
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
                    className={
                      "w-full rounded-input border border-line bg-white pl-3.5 pr-9 py-3 text-[15px] outline-none focus:border-blue " +
                      "appearance-none bg-[url('data:image/svg+xml;utf8,<svg fill=%22%236B8294%22 viewBox=%220 0 20 20%22 xmlns=%22http://www.w3.org/2000/svg%22><path d=%22M5 8l5 5 5-5z%22/></svg>')] bg-no-repeat bg-[length:20px] bg-[right_12px_center]"
                    }
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

            <div className="mt-5 flex justify-between gap-2">
              <Button type="button" variant="outline" onClick={() => setMode("choose")} disabled={busy}>
                ← Back
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
          </>
        )}
      </div>
    </div>
  );
}
