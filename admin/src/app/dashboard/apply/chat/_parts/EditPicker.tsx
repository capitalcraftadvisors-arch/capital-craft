"use client";

// Loan chat · edit mode's "what do you want to change?" multi-select table.

import { useState } from "react";
import EditTable from "@/components/EditTable";
import { PARTNER_THEME as THEME } from "@/components/chat/theme";
import type { Form } from "@/components/chat/types";
import { ContinueRow } from "@/components/chat/DocSlotTable";

// ── Edit picker ──────────────────────────────────────────────────────────────
// The multi-select "what do you want to change?" table shown in edit mode.
// Each row shows the current value (or On file · View for documents); ticked
// rows become the edit script. Documents already on file get a View button.
export default function EditPicker({ appId, form, docRows, preselect = [], onPick }: {
  appId: string; form: Form;
  docRows: { id: string; category: string; storage_path: string | null }[];
  preselect?: string[];
  onPick: (keys: string[]) => void;
}) {
  const [sel, setSel] = useState<string[]>(() => [...preselect]);
  return (
    <div className="flex flex-col gap-2">
      <EditTable appId={appId} form={form} docRows={docRows} value={sel} onChange={setSel} />
      <ContinueRow theme={THEME} label={`Edit selected${sel.length ? ` (${sel.length})` : ""} →`}
        onClick={() => { if (sel.length > 0) onPick(sel); }} disabled={sel.length === 0}
        hint="Tick the fields or documents you want to change." />
    </div>
  );
}
