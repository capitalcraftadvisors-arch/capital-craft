"use client";

// Admin EPC page · the References section editor.

import { useEffect, useState } from "react";
import { MOBILE_RE } from "@/lib/validators";
import type { EpcReference as Reference } from "@/lib/epc-stakeholders";
import { FIELD, SaveCancel, useSectionSave } from "./editor-kit";

// ── References editor — freeform arrays of customer + supplier ─────────
// No admin-side floor: admins can edit down to 0 during review; the min-2+2
// requirement lives in Step 6 (draft-only). Same JSONB shape (type field).
export default function ReferencesEditor({
  value, onSave,
}: {
  value: Reference[];
  onSave: (next: Reference[]) => Promise<void>;
}) {
  const { editing, setEditing, saving, error, setError, commit } = useSectionSave();
  const [draftCust, setDraftCust] = useState<Reference[]>(value.filter((r) => r.type === "customer"));
  const [draftSupp, setDraftSupp] = useState<Reference[]>(value.filter((r) => r.type === "supplier"));

  useEffect(() => {
    setDraftCust(value.filter((r) => r.type === "customer"));
    setDraftSupp(value.filter((r) => r.type === "supplier"));
  }, [value]);

  async function save() {
    for (const r of [...draftCust, ...draftSupp]) {
      if ((r.name || r.mobile) && !(r.name && MOBILE_RE.test(r.mobile))) {
        setError(`Each ${r.type} reference needs both a name and a valid 10-digit mobile.`);
        return;
      }
    }
    const out: Reference[] = [
      ...draftCust.filter((r) => r.name && r.mobile).map((r) => ({ ...r, type: "customer" as const })),
      ...draftSupp.filter((r) => r.name && r.mobile).map((r) => ({ ...r, type: "supplier" as const })),
    ];
    await commit(() => onSave(out));
  }

  if (!editing) {
    return (
      <div>
        {value.length === 0 ? (
          <p className="text-[13px] text-text-muted">No references.</p>
        ) : (
          <>
            <RefReadOnlyGroup title="Customer" refs={value.filter((r) => r.type === "customer")} />
            <RefReadOnlyGroup title="Supplier" refs={value.filter((r) => r.type === "supplier")} />
          </>
        )}
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[12px] text-blue hover:underline"
          >
            Edit references
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <RefEditGroup
        title="Customer references"
        which="customer"
        refs={draftCust}
        onChange={setDraftCust}
      />
      <RefEditGroup
        title="Supplier references"
        which="supplier"
        refs={draftSupp}
        onChange={setDraftSupp}
      />
      <SaveCancel label="Save references" saving={saving} error={error} onSave={save} onCancel={() => { setEditing(false); setError(null); }} />
    </div>
  );
}

function RefReadOnlyGroup({ title, refs }: { title: string; refs: Reference[] }) {
  if (refs.length === 0) return null;
  return (
    <div className="mb-3">
      <p className="text-[12px] text-text-muted mb-1">{title}</p>
      {refs.map((r, i) => (
        <div key={i} className="flex gap-4 text-[13px] py-0.5">
          <dd className="text-text">{r.name} <span className="text-text-muted">· {r.mobile}</span></dd>
        </div>
      ))}
    </div>
  );
}

function RefEditGroup({
  title, which, refs, onChange,
}: {
  title: string;
  which: "customer" | "supplier";
  refs: Reference[];
  onChange: (next: Reference[]) => void;
}) {
  function update(i: number, key: "name" | "mobile", value: string) {
    const next = [...refs];
    next[i] = { ...next[i], [key]: value };
    onChange(next);
  }
  function remove(i: number) {
    onChange(refs.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...refs, { type: which, name: "", mobile: "" }]);
  }
  return (
    <div>
      <p className="text-[12px] text-text-muted mb-2">{title}</p>
      <div className="space-y-2">
        {refs.map((r, i) => (
          <div key={i} className="border border-line rounded-input p-3 bg-bg-soft">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] text-text-muted capitalize">{which} {i + 1}</p>
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-[11px] text-text-muted hover:text-red-500 transition-colors"
              >
                Delete
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                className={FIELD}
                placeholder="Name"
                value={r.name}
                onChange={(e) => update(i, "name", e.target.value)}
              />
              <input
                className={FIELD}
                placeholder="Mobile (10 digits)"
                inputMode="numeric"
                maxLength={10}
                value={r.mobile}
                onChange={(e) => update(i, "mobile", e.target.value.replace(/\D/g, ""))}
              />
            </div>
          </div>
        ))}
        {refs.length === 0 && (
          <p className="text-[12px] text-text-muted">No {which} references.</p>
        )}
      </div>
      <div className="mt-2">
        <button
          type="button"
          onClick={add}
          className="text-[12px] text-blue hover:underline"
        >
          + Add {which} reference
        </button>
      </div>
    </div>
  );
}
