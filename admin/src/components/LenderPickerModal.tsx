"use client";

// Shared modal for the "Download ZIP" flow.
//
// UX: admin clicks Download ZIP → this modal opens with a dropdown of the
// three lenders (CreditFair / Aerem / Solfin). Admin picks one, clicks
// Confirm, modal closes, parent triggers the ZIP fetch with the chosen
// lender as a query param.
//
// Called from BOTH the admin list row action and the View page's bottom
// action bar so the behavior is consistent everywhere. There is no
// "generic" (no-lender) option — every ZIP is targeted at a specific
// lender's template.

import { useState } from "react";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";

export type LenderKey = "creditfair" | "aerem" | "solfin";

const LENDER_OPTIONS: { value: LenderKey; label: string }[] = [
  { value: "creditfair", label: "Credit Fair" },
  { value: "aerem",      label: "Aerem" },
  { value: "solfin",     label: "Solfin" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: (lender: LenderKey) => void | Promise<void>;
  epcName?: string | null;
};

export default function LenderPickerModal({ open, onClose, onConfirm, epcName }: Props) {
  const [lender, setLender] = useState<LenderKey | "">("");
  const [busy, setBusy] = useState(false);

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
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-lg shadow-lg p-6"
      >
        <div className="flex items-start justify-between mb-4">
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-[18px] text-text">Download ZIP</h3>
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
          options={LENDER_OPTIONS}
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
      </div>
    </div>
  );
}
