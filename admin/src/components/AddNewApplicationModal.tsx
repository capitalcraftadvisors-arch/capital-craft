"use client";

// The admin console's "Add new … application" pop-up, shared by
// AddNewLoanAppModal and AddNewInsuranceModal (each passes its own wording,
// EPC list rule, create route and first step).
//
// Flow: pick an EPC partner from the dropdown → POST {createUrl}
// { epc_business_id } creates a fresh draft row (or resumes an existing draft)
// → open its step 1. With `chooser` (loan only) the pop-up first asks how to
// create the application: the Application maker chat, or the classic form
// (the EPC dropdown); the EPC list is only read once the classic form is picked.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { authHeaders } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The line under the title while the EPC dropdown shows. */
  pickHint: string;
  /** true: only EPCs with has_lender_approval. false: every non-admin EPC. */
  lenderApprovedOnly: boolean;
  loadingText: string;
  /** Shown instead of the dropdown when no EPC qualifies. */
  emptyText: ReactNode;
  /** POST { epc_business_id } → { ok, application: { id } }. */
  createUrl: string;
  /** The draft's first step. */
  stepOnePath: (id: string) => string;
  /** Start on a chooser: the chat at `chatPath`, or the classic form. */
  chooser?: { hint: string; chatPath: string };
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

export default function AddNewApplicationModal({
  open, onClose, title, pickHint, lenderApprovedOnly, loadingText, emptyText, createUrl, stepOnePath, chooser,
}: Props) {
  const router = useRouter();
  const hasChooser = !!chooser;
  const [mode, setMode] = useState<"choose" | "classic">(hasChooser ? "choose" : "classic");
  const [epcs, setEpcs] = useState<EpcOption[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to the chooser every time the modal opens.
  useEffect(() => {
    if (!open || !hasChooser) return;
    setMode("choose");
    setError(null);
    setSelected("");
  }, [open]);

  // Load EPCs only when the classic form shows (straight away when there is no chooser).
  useEffect(() => {
    if (!open || mode !== "classic") return;
    setError(null);
    setSelected("");
    setLoading(true);
    void (async () => {
      let q = supabase()
        .from("epc_business")
        .select("id, epc_display_id, contact_name, trade_name, legal_name");
      if (lenderApprovedOnly) q = q.eq("has_lender_approval", true);
      const { data, error: qErr } = await q
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
    router.push(chooser!.chatPath as any);
  }

  async function submit() {
    if (!selected) { setError("Pick an EPC to continue."); return; }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(createUrl, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ epc_business_id: selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setError(data?.error || `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      onClose();
      router.push(stepOnePath(data.application.id) as any);
    } catch (e) {
      setError((e as Error)?.message || "Network error.");
      setBusy(false);
    }
  }

  return (
    <Modal onClose={close} busy={busy} className="w-full max-w-md bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-display font-semibold text-[18px] text-text">{title}</h3>
          <p className="text-[12px] text-text-mid mt-0.5">
            {mode === "choose" && chooser ? chooser.hint : pickHint}
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          disabled={busy}
          className="text-[18px] text-text-muted hover:text-text leading-none"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {mode === "choose" && chooser ? (
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
                <p className="text-[13px] text-text-muted py-2">{loadingText}</p>
              ) : epcs.length === 0 ? (
                <div className="p-3 rounded-input bg-bg-tint border border-line text-[13px] text-text-mid">
                  {emptyText}
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

          {/* With the chooser: ← Back to it. Without: Cancel closes the pop-up. */}
          <div className={`mt-5 flex ${chooser ? "justify-between" : "justify-end"} gap-2`}>
            {chooser ? (
              <Button type="button" variant="outline" onClick={() => setMode("choose")} disabled={busy}>
                ← Back
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={close} disabled={busy}>
                Cancel
              </Button>
            )}
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
    </Modal>
  );
}
