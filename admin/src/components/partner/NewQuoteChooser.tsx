"use client";

// "New quotation" — pick the template:
//   Simple  — Capital Craft's standard quotation (the saved, editable Quotations)
//   Custom  — the EPC's own company format, made by CC from a sample the EPC
//             uploads (0122): free for 3 months once ready, then locked until CC
//             switches it on (lib/custom-template).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { NAVY } from "@/components/partner/PartnerShell";
import FileUpload from "@/components/FileUpload";
import { getBusiness } from "@/lib/auth";
import { canManageOrg } from "@/lib/epc-roles";
import { fmtDate } from "@/lib/dates";
import { customState, freeUntil, CUSTOM_LOCKED_MSG } from "@/lib/custom-template";
import { markCustomTemplateSeen } from "@/components/partner/CustomTemplateBanner";
import type { QuoteTemplate } from "@/lib/quotation-template";

export default function NewQuoteChooser({ segment, tpl, onClose }: {
  segment: "residential" | "commercial";
  tpl: QuoteTemplate | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const me = getBusiness();
  const state = tpl ? customState(tpl) : null;
  const [samples, setSamples] = useState(0); // the sample quotations uploaded (no template yet)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const tile = "flex-1 min-w-[240px] rounded-2xl border border-line bg-white p-5 flex flex-col gap-3";
  const primary = "self-start px-4 py-2.5 rounded-xl text-white text-[13.5px] font-semibold";
  const note = "text-[13px] leading-relaxed";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="w-full max-w-[720px] bg-bg-soft rounded-2xl shadow-xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-[20px] font-bold text-[#0f3d2e]">New {segment} quotation</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 grid place-items-center rounded-lg text-text-muted hover:bg-white">✕</button>
        </div>

        <div className="flex gap-4 flex-wrap">
          <div className={tile}>
            <div>
              <div className="text-[16px] font-bold text-[#0f3d2e]">Simple template</div>
              <div className="text-[13px] text-text-muted mt-0.5">Capital Craft standard quotation</div>
            </div>
            <button type="button" onClick={() => router.push(`/dashboard/quotes/new?segment=${segment}` as any)}
              className={primary + " mt-auto"} style={{ background: NAVY }}>
              Make quotation
            </button>
          </div>

          <div className={tile}>
            <div>
              <div className="text-[16px] font-bold text-[#0f3d2e]">Custom template</div>
              <div className="text-[13px] text-text-muted mt-0.5">Your company&apos;s own quotation format</div>
            </div>

            {state === "ready" && tpl ? (
              <>
                {!tpl.unlocked && tpl.ready_at && <p className="text-[12.5px] text-text-muted">Free till {fmtDate(freeUntil(tpl.ready_at).toISOString())}</p>}
                <button type="button" onClick={() => { markCustomTemplateSeen(tpl); router.push("/dashboard/quotation" as any); }}
                  className={primary + " mt-auto"} style={{ background: NAVY }}>
                  Make quotation
                </button>
              </>
            ) : state === "locked" ? (
              <p className={note + " text-[#854f0b] bg-[#fef8ee] border border-[#f3d9a4] rounded-xl px-3 py-2.5"}>🔒 {CUSTOM_LOCKED_MSG}</p>
            ) : state === "making" ? (
              <p className={note + " text-[#0f3d2e]"}>We&apos;re making your custom template. We&apos;ll let you know when it&apos;s ready.</p>
            ) : canManageOrg(me) ? (
              <>
                <p className={note + " text-[#0f3d2e]"}>
                  {samples > 0
                    ? "We're making your custom template. We'll let you know when it's ready."
                    : "Upload a sample of your company's quotation. We'll make your custom template from it."}
                </p>
                <FileUpload table="epc_documents" category="custom_quote_sample" businessId={me?.id} uploadedBy="epc"
                  maxFiles={3} uploadHint="PDF or photo" onCountChange={setSamples} />
              </>
            ) : (
              <p className={note + " text-text-muted"}>Ask your company owner to upload a sample quotation.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
