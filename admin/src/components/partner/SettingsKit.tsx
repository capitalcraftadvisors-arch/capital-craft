"use client";

// Building blocks of the partner Settings pages (Zoho-style): a card, a
// label-beside-control row, a read-only value and the Save bar.

import type { ReactNode } from "react";
import { NAVY } from "@/components/partner/PartnerShell";

export function Card({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-line p-5 sm:p-6 mb-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-[14px] font-semibold text-[#0f3d2e]">{title}</h2>
        {right}
      </div>
      <div className="flex flex-col gap-3.5">{children}</div>
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[180px_1fr] sm:items-start">
      <span className="text-[13px] font-medium text-text-mid sm:pt-2">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Value({ label, v }: { label: string; v: unknown }) {
  const s = v == null || v === "" ? "—" : String(v);
  return (
    <Row label={label}>
      <span className="block text-[14px] text-text font-medium break-words sm:pt-2">{s}</span>
    </Row>
  );
}

export function SaveBar({ busy, saved, error, onSave, disabled }: { busy: boolean; saved: boolean; error: string | null; onSave: () => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button type="button" onClick={onSave} disabled={busy || disabled}
        className="px-5 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-60" style={{ background: NAVY }}>
        {busy ? "Saving…" : "Save"}
      </button>
      {saved && !error && <span className="text-[13px] text-[#178a5c] font-medium">Saved</span>}
      {error && <span className="text-[13px] text-red-600">{error}</span>}
    </div>
  );
}
