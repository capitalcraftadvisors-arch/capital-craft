"use client";

// "Your custom template is ready" — on the partner Dashboard and Quotations page
// once CC marks the EPC's custom quotation template ready (0122): first "buy the
// premium subscription" (locked), then "you can use it now" (unlocked) — each until
// the EPC opens it or closes this. Remembered per browser (no request).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NAVY } from "@/components/partner/PartnerShell";
import { getBusiness } from "@/lib/auth";
import { canWork } from "@/lib/epc-roles";
import { customState, CUSTOM_LOCKED_MSG } from "@/lib/custom-template";
import { SARVATRA } from "@/lib/quotation-brands";
import type { QuoteTemplate } from "@/lib/quotation-template";

const seenKey = () => `cc_tpl_ready_seen:${getBusiness()?.id ?? ""}`;

// The news this template carries now: its ready date + locked / ready.
const newsOf = (tpl: QuoteTemplate) => `${tpl.ready_at}|${customState(tpl)}`;

/** Opening the custom template counts as seeing the news. */
export function markCustomTemplateSeen(tpl: QuoteTemplate | null | undefined) {
  if (tpl?.ready_at) try { localStorage.setItem(seenKey(), newsOf(tpl)); } catch { /* private mode */ }
}

export default function CustomTemplateBanner({ tpl }: { tpl: QuoteTemplate | null | undefined }) {
  const router = useRouter();
  const [seen, setSeen] = useState<string | null>(() => { try { return localStorage.getItem(seenKey()); } catch { return null; } });
  if (!tpl?.ready_at || tpl.storage_path === SARVATRA.key || seen === newsOf(tpl)) return null;
  const usable = customState(tpl) === "ready";

  const close = () => { markCustomTemplateSeen(tpl); setSeen(newsOf(tpl)); };
  return (
    <div className="mb-4 flex items-center gap-3 flex-wrap rounded-2xl border border-cc-line bg-cc-wash px-4 py-3">
      <span className="grid place-items-center w-8 h-8 rounded-full bg-cc-green text-white text-[15px] font-bold shrink-0">✓</span>
      <p className="text-[14px] font-semibold text-cc-ink">{usable ? "Your custom template is ready. You can use it now." : CUSTOM_LOCKED_MSG}</p>
      <div className="ml-auto flex items-center gap-2">
        {usable && canWork(getBusiness()) && (
          <button type="button" onClick={() => { close(); router.push("/dashboard/quotation"); }}
            className="px-4 py-2 rounded-xl text-white text-[13px] font-semibold" style={{ background: NAVY }}>
            Use it
          </button>
        )}
        <button type="button" onClick={close} aria-label="Close" className="w-8 h-8 grid place-items-center rounded-lg text-text-muted hover:bg-white">✕</button>
      </div>
    </div>
  );
}
