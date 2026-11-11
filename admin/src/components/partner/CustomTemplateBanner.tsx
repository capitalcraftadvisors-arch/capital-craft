"use client";

// "Your custom template is ready" — on the partner Dashboard and Quotations page
// once CC marks the EPC's custom quotation template ready (0122), until the EPC
// opens it or closes this. Remembered per browser (no request).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NAVY } from "@/components/partner/PartnerShell";
import { getBusiness } from "@/lib/auth";
import { canWork } from "@/lib/epc-roles";
import { customState } from "@/lib/custom-template";
import { SARVATRA } from "@/lib/quotation-brands";
import type { QuoteTemplate } from "@/lib/quotation-template";

const seenKey = () => `cc_tpl_ready_seen:${getBusiness()?.id ?? ""}`;

/** Opening the custom template counts as seeing the news. */
export function markCustomTemplateSeen(tpl: QuoteTemplate | null | undefined) {
  if (tpl?.ready_at) try { localStorage.setItem(seenKey(), tpl.ready_at); } catch { /* private mode */ }
}

export default function CustomTemplateBanner({ tpl }: { tpl: QuoteTemplate | null | undefined }) {
  const router = useRouter();
  const [seen, setSeen] = useState<string | null>(() => { try { return localStorage.getItem(seenKey()); } catch { return null; } });
  if (!tpl?.ready_at || tpl.storage_path === SARVATRA.key || customState(tpl) !== "ready" || seen === tpl.ready_at) return null;

  const close = () => { markCustomTemplateSeen(tpl); setSeen(tpl.ready_at); };
  return (
    <div className="mb-4 flex items-center gap-3 flex-wrap rounded-2xl border border-[#cdeadd] bg-[#f0faf5] px-4 py-3">
      <span className="grid place-items-center w-8 h-8 rounded-full bg-[#178a5c] text-white text-[15px] font-bold shrink-0">✓</span>
      <p className="text-[14px] font-semibold text-[#0f3d2e]">Your custom template is ready. You can use it now.</p>
      <div className="ml-auto flex items-center gap-2">
        {canWork(getBusiness()) && (
          <button type="button" onClick={() => { close(); router.push("/dashboard/quotation" as any); }}
            className="px-4 py-2 rounded-xl text-white text-[13px] font-semibold" style={{ background: NAVY }}>
            Use it
          </button>
        )}
        <button type="button" onClick={close} aria-label="Close" className="w-8 h-8 grid place-items-center rounded-lg text-text-muted hover:bg-white">✕</button>
      </div>
    </div>
  );
}
