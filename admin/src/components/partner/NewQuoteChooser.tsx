"use client";

// "New quotation" — pick the template:
//   Simple  — Capital Craft's standard quotation (the saved, editable Quotations)
//   Custom  — the EPC's own company format, made by CC from a sample the EPC
//             uploads (0122): free for 3 months once ready, then locked until CC
//             switches it on (lib/custom-template).

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { NAVY } from "@/components/partner/PartnerShell";
import FileUpload from "@/components/FileUpload";
import Modal from "@/components/ui/Modal";
import { getBusiness } from "@/lib/auth";
import { canManageOrg } from "@/lib/epc-roles";
import { customState, CUSTOM_LOCKED_MSG } from "@/lib/custom-template";
import { markCustomTemplateSeen } from "@/components/partner/CustomTemplateBanner";
import { SARVATRA } from "@/lib/quotation-brands";
import type { QuoteTemplate } from "@/lib/quotation-template";

export default function NewQuoteChooser({ segment, tpl, onClose }: {
  segment: "residential" | "commercial";
  tpl: QuoteTemplate | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const me = getBusiness();
  // The gozerobils builder (Sustera) is its Customer applications, and never locks.
  const customers = tpl?.storage_path === SARVATRA.key;
  const state = tpl ? (customers ? "ready" : customState(tpl)) : null;
  const [samples, setSamples] = useState(0); // the sample quotations uploaded (no template yet)
  const titleId = useId();

  const tile = "flex-1 min-w-[240px] rounded-2xl border border-line bg-white p-5 flex flex-col gap-3";
  const primary = "self-start px-4 py-2.5 rounded-xl text-white text-[13.5px] font-semibold";
  const note = "text-[13px] leading-relaxed";

  return (
    <Modal onClose={onClose} closeOnEscape overlayClassName="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" className="w-full max-w-[720px] bg-bg-soft rounded-2xl shadow-xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto" aria-labelledby={titleId}>
      <div className="flex items-center justify-between mb-4">
        <h2 id={titleId} className="font-display text-[20px] font-bold text-cc-ink">New {segment} quotation</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 grid place-items-center rounded-lg text-text-muted hover:bg-white">✕</button>
      </div>

      <div className="flex gap-4 flex-wrap">
        <div className={tile}>
          <div>
            <div className="text-[16px] font-bold text-cc-ink">Simple template</div>
            <div className="text-[13px] text-text-muted mt-0.5">Capital Craft standard quotation</div>
          </div>
          <button type="button" onClick={() => router.push(`/dashboard/quotes/new?segment=${segment}`)}
            className={primary + " mt-auto"} style={{ background: NAVY }}>
            Make quotation
          </button>
        </div>

        <div className={tile}>
          <div>
            <div className="text-[16px] font-bold text-cc-ink">Custom template</div>
            <div className="text-[13px] text-text-muted mt-0.5">Your company&apos;s own quotation format</div>
          </div>

          {state === "ready" && tpl ? (
            <>
              <button type="button" onClick={() => { if (customers) { router.push("/dashboard?s=customers"); return; } markCustomTemplateSeen(tpl); router.push("/dashboard/quotation"); }}
                className={primary + " mt-auto"} style={{ background: NAVY }}>
                Make quotation
              </button>
            </>
          ) : state === "locked" ? (
            <p className={note + " text-warn-ink bg-warn-wash border border-warn-line rounded-xl px-3 py-2.5"}>🔒 {CUSTOM_LOCKED_MSG}</p>
          ) : state === "making" ? (
            <p className={note + " text-cc-ink"}>We&apos;re making your custom template. We&apos;ll let you know when it&apos;s ready.</p>
          ) : canManageOrg(me) ? (
            <>
              <p className={note + " text-cc-ink"}>
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
    </Modal>
  );
}
