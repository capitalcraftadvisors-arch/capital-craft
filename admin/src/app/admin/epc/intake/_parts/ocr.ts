// EPC onboarding chat · reads a business PAN, GST certificate or cancelled cheque
// into an epc_business column patch + the "Read from the document" rows.

import { authHeaders } from "@/lib/auth";
import { extractPan, extractGstLegalName } from "@/lib/ocr";
import type { Fetched } from "@/components/chat/types";

// Runs the matching OCR route/helper and returns a column patch + display list.
export async function ocrDoc(kind: "pan" | "gst" | "cheque", file: File): Promise<{ patch: Record<string, unknown>; fields: Fetched[] }> {
  const row = (label: string, value: unknown, field?: string): Fetched => {
    const v = value == null || value === "" ? "" : String(value);
    return { label, value: v, ok: !!v, field };
  };
  // Per-kind "couldn't read" list — shown (editable) whenever OCR fails, errors,
  // times out or returns an unexpected shape, so the chat never stalls or throws.
  const blank = (): Fetched[] =>
    kind === "pan" ? [row("PAN", "", "pan_number"), row("Name", ""), row("Father", "")]
    : kind === "gst" ? [row("Legal name", "", "legal_name"), row("Trade name", "", "trade_name"), row("GSTIN", "", "gstin_number"), row("GST address", "", "gst_address")]
    : [row("Account no.", "", "bank_account_number"), row("IFSC", "", "bank_ifsc"), row("Bank", "", "bank_name")];
  try {
    if (kind === "pan") {
      const r = await extractPan(file);
      if (!r.ok) return { patch: {}, fields: blank() };
      return { patch: { pan_number: (r.pan || "").toUpperCase() }, fields: [row("PAN", r.pan, "pan_number"), row("Name", r.name), row("Father", r.father_name)] };
    }
    if (kind === "gst") {
      const r = await extractGstLegalName(file);
      if (!r.ok) return { patch: {}, fields: blank() };
      return {
        patch: { legal_name: r.legal_name || "", trade_name: r.trade_name || "", gstin_number: (r.gstin || "").toUpperCase(), gst_address: r.address || "" },
        fields: [row("Legal name", r.legal_name, "legal_name"), row("Trade name", r.trade_name, "trade_name"), row("GSTIN", r.gstin, "gstin_number"), row("GST address", r.address, "gst_address")],
      };
    }
    // cheque
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/epc/extract-cheque", { method: "POST", headers: authHeaders(), body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) return { patch: {}, fields: blank() };
    return {
      patch: { bank_account_number: j.accountNumber || "", bank_ifsc: (j.ifsc || "").toUpperCase(), bank_name: j.bankName || "" },
      fields: [row("Account no.", j.accountNumber, "bank_account_number"), row("IFSC", j.ifsc, "bank_ifsc"), row("Bank", j.bankName, "bank_name")],
    };
  } catch {
    return { patch: {}, fields: blank() };
  }
}
