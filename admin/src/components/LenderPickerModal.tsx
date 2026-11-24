"use client";

// Shared modal for the "Download ZIP" flow.
//
// UX: admin clicks Download ZIP → this modal opens with a dropdown of the
// portal's lenders (the registry — lib/lenders). Admin picks one, clicks
// Confirm, modal closes, parent triggers the ZIP fetch with the chosen
// lender as a query param.
//
// Called from BOTH the admin list row action and the View page's bottom
// action bar so the behavior is consistent everywhere. There is no
// "generic" (no-lender) option — every ZIP is targeted at a specific
// lender's template.

import { useId, useState } from "react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import { useLenders } from "@/lib/lenders";
import { notify } from "@/lib/notify";

// A registered lender's key (lenders registry).
export type LenderKey = string;

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: (lender: LenderKey) => void | Promise<void>;
  epcName?: string | null;
};

export default function LenderPickerModal({ open, onClose, onConfirm, epcName }: Props) {
  const [lender, setLender] = useState<LenderKey | "">("");
  const [busy, setBusy] = useState(false);
  const lenders = useLenders();
  const titleId = useId();

  if (!open) return null;

  function close() {
    if (busy) return;
    setLender("");
    onClose();
  }

  async function submit() {
    if (!lender) return;
    setBusy(true);
    try {
      await onConfirm(lender);
      setLender("");
      onClose();
    } catch (e) {
      notify.error("Download failed: " + (e as Error)?.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={close} className="w-full max-w-md bg-white rounded-lg shadow-lg p-6" aria-labelledby={titleId}>
      <div className="flex items-start justify-between mb-4">
        <div className="min-w-0">
          <h3 id={titleId} className="font-display font-semibold text-[18px] text-text">Download ZIP</h3>
          <p className="text-[12px] text-text-mid mt-0.5">
            {epcName ? `For ${epcName}. ` : ""}Pick the lender you&rsquo;re preparing the ZIP for — the Excel inside is built to that lender&rsquo;s template.
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          disabled={busy}
          className="text-[18px] text-text-muted hover:text-text leading-none disabled:opacity-40"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <Select
        label="Lender"
        placeholder="Select a lender…"
        options={lenders.map((l) => ({ value: l.key, label: l.label }))}
        value={lender}
        onChange={(e) => setLender(e.target.value as LenderKey | "")}
      />

      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={close} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={submit} disabled={!lender} loading={busy}>
          Confirm &amp; download
        </Button>
      </div>
    </Modal>
  );
}
