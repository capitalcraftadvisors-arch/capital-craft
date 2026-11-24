"use client";

// The partner portal's one-tap WhatsApp button (Partner Portal v2). A paid
// feature: without the subscription (lib/subscription) it stays visible with a
// lock and says whom to contact.

import { SUBSCRIPTION_MSG } from "@/lib/subscription";

export default function WhatsAppButton({ on, busy, onClick, label = "WhatsApp", className = "" }: {
  on: boolean; busy?: boolean; onClick: () => void; label?: string; className?: string;
}) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); if (on) onClick(); }} disabled={!on || busy}
      title={on ? undefined : SUBSCRIPTION_MSG}
      className={["inline-flex items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap", on ? "text-whatsapp hover:underline" : "text-text-muted cursor-not-allowed", "disabled:opacity-60", className].join(" ")}>
      {on
        ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3z" /></svg>
        : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>}
      {busy ? "Preparing…" : label}
    </button>
  );
}
