"use client";

// Admin-only "Add New EPC" flow.
//
// UX:
//   1. Admin clicks "Add New EPC" on the list toolbar.
//   2. Modal asks for a 10-digit mobile only. Everything else the wizard
//      already collects.
//   3. Submit → POST /api/admin/create-epc.
//      - On duplicate: shows a warning + link to that EPC's detail page.
//      - On success:   beginImpersonation({new EPC context}) and redirects
//                      to /onboarding/step-1. The wizard now runs against
//                      the new EPC using admin RLS.

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import { authHeaders, beginImpersonation } from "@/lib/auth";
import { MOBILE_RE } from "@/lib/validators";

type Props = {
  open: boolean;
  onClose: () => void;
};

type DuplicateWarning = {
  id: string;
  display_id: string | null;
  contact_name: string | null;
};

export default function AddNewEpcModal({ open, onClose }: Props) {
  const router = useRouter();
  const [mobile, setMobile] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateWarning | null>(null);
  const titleId = useId();

  if (!open) return null;

  function reset() {
    setMobile("");
    setBusy(false);
    setError(null);
    setDuplicate(null);
  }

  function close() {
    reset();
    onClose();
  }

  // Primary path — hand the mobile to the guided chat, which creates the EPC
  // (or opens the existing one) and builds the profile turn by turn.
  function goChat() {
    setError(null);
    const m = mobile.replace(/\D/g, "");
    if (!MOBILE_RE.test(m)) { setError("Enter a valid 10-digit Indian mobile."); return; }
    onClose();
    router.push(`/admin/epc/intake?mobile=${m}`);
  }

  async function submit() {
    setError(null);
    setDuplicate(null);
    const m = mobile.replace(/\D/g, "");
    if (!MOBILE_RE.test(m)) {
      setError("Enter a valid 10-digit Indian mobile.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/create-epc", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ mobile: m }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      if (data.duplicate) {
        setDuplicate({
          id: data.business.id,
          display_id: data.business.display_id,
          contact_name: data.business.contact_name,
        });
        return;
      }
      // New EPC created — begin impersonation and jump into the wizard.
      beginImpersonation({
        id: data.business.id,
        status: data.business.status,
        business_type: data.business.business_type,
        current_step: data.business.current_step ?? 1,
        contact_name: data.business.contact_name,
      });
      onClose();
      router.push("/onboarding/step-1");
    } catch (e) {
      setError((e as Error).message || "Couldn't create the EPC.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={close} busy={busy} className="w-full max-w-md bg-white rounded-lg shadow-lg p-6" aria-labelledby={titleId}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 id={titleId} className="font-display font-semibold text-[18px] text-text">Add new EPC</h3>
          <p className="text-[12px] text-text-mid mt-0.5">
            Enter the EPC&rsquo;s mobile number, then build the profile in a guided chat &mdash; or use the classic form.
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

      <div className="space-y-3">
        <Input
          label="Mobile number"
          placeholder="10-digit mobile"
          inputMode="numeric"
          maxLength={10}
          value={mobile}
          onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
          error={error ?? undefined}
        />

        {duplicate && (
          <div className="p-3 rounded-input bg-amber-50 border border-amber-300 text-[13px] text-amber-900">
            <p className="font-medium">An EPC with this mobile already exists.</p>
            <p className="text-[12px] mt-0.5">
              {duplicate.contact_name ? `${duplicate.contact_name} · ` : ""}
              {duplicate.display_id ?? duplicate.id.slice(0, 8)}
            </p>
            <button
              type="button"
              onClick={() => {
                onClose();
                router.push(`/admin/epc/${duplicate.id}`);
              }}
              className="mt-2 text-[12px] font-semibold text-amber-900 underline"
            >
              Open existing EPC →
            </button>
          </div>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2 flex-wrap">
        <Button type="button" variant="outline" onClick={close} disabled={busy}>
          Cancel
        </Button>
        {/* Classic step-by-step wizard (unchanged) — kept for parity with the chat. */}
        <Button type="button" variant="outline" onClick={submit} loading={busy}>
          Classic form
        </Button>
        {/* Guided chat — the primary way to onboard now. */}
        <Button type="button" variant="primary" onClick={goChat} disabled={busy}>
          Build in chat
        </Button>
      </div>
    </Modal>
  );
}
