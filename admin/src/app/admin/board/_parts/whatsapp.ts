// Task Manager — WhatsApp composer data: the pending-document lists, message intents, the message text, and the loan doc check.

import { supabase } from "@/lib/supabase";
import type { OpsCase, CaseSource } from "@/lib/ops-board";
import type { WaLang } from "@/lib/wa-link";

// ── WhatsApp composer (Hindi) ────────────────────────────────────────────────
// The pending items an RM can tick; `hi` is the Devanagari phrase used in the
// message. English labels keep the operator UI readable.
export const WA_PENDING: { key: string; label: string; hi: string }[] = [
  { key: "aadhaar",   label: "Aadhaar card",           hi: "आधार कार्ड" },
  { key: "pan",       label: "PAN card",               hi: "पैन कार्ड" },
  { key: "ebill",     label: "Electricity bill",       hi: "बिजली का बिल" },
  { key: "bank",      label: "Bank statement (6 mo.)", hi: "6 महीने की बैंक स्टेटमेंट" },
  { key: "photo",     label: "Passport-size photo",    hi: "पासपोर्ट साइज़ फोटो" },
  { key: "quotation", label: "Solar quotation",        hi: "सोलर सिस्टम का कोटेशन" },
  { key: "coapp",     label: "Co-applicant KYC",       hi: "को-एप्लिकेंट के दस्तावेज़ (आधार व पैन)" },
  { key: "income",    label: "Income proof / ITR",     hi: "आय प्रमाण (ITR / सैलरी स्लिप)" },
  { key: "cheque",    label: "Cancelled cheque",       hi: "कैंसिल चेक" },
  { key: "gst",       label: "GST certificate",        hi: "GST प्रमाणपत्र" },
];
// EPC onboarding documents — a PARTNER's paperwork, not a loan applicant's.
// Used by the WhatsApp composer when the case is an EPC (source === "epc").
const WA_PENDING_EPC: { key: string; label: string; hi: string }[] = [
  { key: "biz_pan",  label: "Business PAN card",           hi: "प्रतिष्ठान का पैन कार्ड" },
  { key: "gst",      label: "GST certificate",             hi: "GST प्रमाणपत्र" },
  { key: "reg",      label: "Registration proof",          hi: "पंजीकरण प्रमाण (डीड / इनकॉर्पोरेशन)" },
  { key: "owner_aadhaar", label: "Owner / partner Aadhaar", hi: "मालिक / पार्टनर का आधार कार्ड" },
  { key: "owner_pan",     label: "Owner / partner PAN",     hi: "मालिक / पार्टनर का पैन कार्ड" },
  { key: "photo",    label: "Owner photo",                 hi: "मालिक की पासपोर्ट साइज़ फोटो" },
  { key: "cheque",   label: "Cancelled cheque",            hi: "कैंसिल चेक" },
  { key: "bank",     label: "Bank account details",        hi: "बैंक खाता विवरण" },
];
// Message intents (message text only — the composer UI itself stays English).
export type WaIntent = "docs" | "approved" | "disbursed" | "followup";
export const WA_INTENTS: { key: WaIntent; label: string }[] = [
  { key: "docs",      label: "Docs pending" },
  { key: "disbursed", label: "Disbursement" },
  { key: "followup",  label: "Follow-up" },
];
// EPC intents — no "disbursement" (partners don't get disbursed); instead an
// "Onboarded" congratulations once the partner profile is approved.
export const WA_INTENTS_EPC: { key: WaIntent; label: string }[] = [
  { key: "docs",     label: "Onboarding docs" },
  { key: "approved", label: "Onboarded" },
  { key: "followup", label: "Follow-up" },
];
// Pick the right pending-docs list for a case's source.
export const waPendingFor = (source: CaseSource) => (source === "epc" ? WA_PENDING_EPC : WA_PENDING);
// Build the WhatsApp message from name, RM, chosen doc keys, source, intent, language.
export function buildWaMessage(customer: string, rm: string, itemKeys: string[], source: CaseSource, intent: WaIntent, lang: WaLang, epc?: string | null): string {
  const name = customer && customer !== "—" ? customer : "";
  const isEpc = source === "epc";
  const vendor = epc && epc !== "—" ? epc : "";
  const items = waPendingFor(source).filter((it) => itemKeys.includes(it.key));
  if (lang === "en") {
    const greet = name ? `Hello ${name},` : "Hello,";
    const who = `This is ${rm} from Capital Craft Financial Advisors.`;
    const subj = isEpc ? "your Capital Craft partner profile" : "your solar loan application";
    const sign = `\n\nThank you,\n${rm}\nCapital Craft Financial Advisors`;
    switch (intent) {
      case "approved":  return `${greet}\n\nCongratulations! ${who} ${subj} has been approved. We'll reach out shortly for the next steps. Feel free to contact us with any questions.${sign}`;
      case "disbursed": return `${greet}\n\n${who} Your loan amount has been credited to your solar vendor${vendor ? ` (${vendor})` : ""}'s bank account. For details, please contact your solar vendor.${sign}`;
      case "followup":  return `${greet}\n\n${who} We wanted to follow up regarding ${subj}. Please reply or contact us at your convenience.${sign}`;
      default:
        if (!items.length) return `${greet}\n\n${who} To move ${subj} forward, we need a few documents/details. Please get in touch.${sign}`;
        return `${greet}\n\n${who} To move ${subj} forward, we need the following documents/information:\n\n${items.map((it) => `• ${it.label}`).join("\n")}\n\nPlease share them on WhatsApp as soon as possible.${sign}`;
    }
  }
  if (lang === "hinglish") {
    const greet = name ? `Namaste ${name} ji,` : "Namaste ji,";
    const who = `Main ${rm}, Capital Craft Financial Advisors se hoon.`;
    const subj = isEpc ? "aapki Capital Craft partner profile" : "aapke solar loan application";
    const sign = `\n\nDhanyavaad,\n${rm}\nCapital Craft Financial Advisors`;
    switch (intent) {
      case "approved":  return `${greet}\n\nBadhai ho! ${who} ${subj} approved ho gaya hai. Agle steps ke liye hum jald sampark karenge. Koi sawaal ho to zaroor bataiye.${sign}`;
      case "disbursed": return `${greet}\n\n${who} Aapke loan ki amount aapke solar vendor${vendor ? ` (${vendor})` : ""} ke bank account me ja chuki hai. Details ke liye apne solar vendor se sampark karein.${sign}`;
      case "followup":  return `${greet}\n\n${who} ${subj} ke baare mein aapse follow-up karna tha. Kripya reply karein ya sampark karein.${sign}`;
      default:
        if (!items.length) return `${greet}\n\n${who} ${subj} ko aage badhane ke liye kuch documents chahiye. Kripya sampark karein.${sign}`;
        return `${greet}\n\n${who} ${subj} ko aage badhane ke liye humein ye documents/jaankari chahiye:\n\n${items.map((it) => `• ${it.label}`).join("\n")}\n\nKripya inhe jald se jald WhatsApp par bhejein.${sign}`;
    }
  }
  // hi — easy Hindi
  const greet = name ? `नमस्ते ${name} जी,` : "नमस्ते जी,";
  const who = `मैं ${rm}, Capital Craft Financial Advisors से हूँ।`;
  const subj = isEpc ? "आपकी Capital Craft पार्टनर प्रोफ़ाइल" : "आपके सोलर लोन आवेदन";
  const sign = `\n\nधन्यवाद,\n${rm}\nCapital Craft Financial Advisors`;
  switch (intent) {
    case "approved":  return `${greet}\n\nबधाई हो! ${who} ${subj} स्वीकृत हो गया है। अगले चरण के लिए हम जल्द ही आपसे संपर्क करेंगे। कोई सवाल हो तो ज़रूर बताएं।${sign}`;
    case "disbursed": return `${greet}\n\n${who} आपके लोन की राशि आपके सोलर वेंडर${vendor ? ` (${vendor})` : ""} के बैंक खाते में भेजी जा चुकी है। विवरण के लिए कृपया अपने सोलर वेंडर से संपर्क करें।${sign}`;
    case "followup":  return `${greet}\n\n${who} ${subj} के बारे में आपसे बात करनी थी। कृपया जवाब दें या संपर्क करें।${sign}`;
    default:
      if (!items.length) return `${greet}\n\n${who} ${subj} को आगे बढ़ाने के लिए कुछ दस्तावेज़ चाहिए। कृपया संपर्क करें।${sign}`;
      return `${greet}\n\n${who} ${subj} को आगे बढ़ाने के लिए हमें ये दस्तावेज़ चाहिए:\n\n${items.map((it) => `• ${it.hi}`).join("\n")}\n\nकृपया इन्हें जल्दी WhatsApp पर भेजें।${sign}`;
  }
}

// Auto-detect pending docs for a LOAN (on-demand only). Returns the checklist
// keys that appear MISSING across both doc stores.
export async function detectPendingDocs(c: OpsCase): Promise<{ have: string[]; need: string[] }> {
  if (c.source !== "loan") return { have: [], need: [] };
  try {
    const db = supabase();
    // NOTE: column list is verified against the live schema. epc_applications
    // has NO pan_path / invoice_path / gst_path — the borrower PAN is the
    // `borrower_pan` text column (and/or a user_application_docs row). Selecting
    // a non-existent column 42703s the whole query → the old check detected
    // nothing (the "inaccurate" behaviour).
    const [appRes, docRes] = await Promise.all([
      db.from("epc_applications").select("aadhaar_front_path, aadhaar_back_path, aadhaar_face_path, borrower_pan, ebill_path, bank_statement_path, customer_photo_path, proforma_invoice_path, coapp_name, coapp_pan, coapp_pan_path, coapp_aadhaar_front_path, coapp_aadhaar_back_path").eq("id", c.id).maybeSingle(),
      db.from("user_application_docs").select("category").eq("application_id", c.id),
    ]);
    const p = (appRes.data ?? {}) as Record<string, unknown>;
    const cats = new Set(((docRes.data ?? []) as { category: string }[]).map((d) => d.category));
    const str = (v: unknown) => typeof v === "string" && v.trim() !== "";
    const hasCoapp = str(p.coapp_name);
    // Verifiable docs get true/false; anything we can't check (income, cheque,
    // GST — no column on loan apps — or co-applicant docs when there's no
    // co-applicant) is null → left to the RM to tick manually, never
    // auto-flagged as "missing".
    const status: Record<string, boolean | null> = {
      aadhaar:   !!p.aadhaar_front_path || !!p.aadhaar_back_path || !!p.aadhaar_face_path,
      pan:       str(p.borrower_pan) || cats.has("borrower_pan"),
      ebill:     !!p.ebill_path,
      bank:      !!p.bank_statement_path || cats.has("bank_statement"),
      photo:     !!p.customer_photo_path || !!p.aadhaar_face_path || cats.has("customer_photo") || cats.has("borrower_photo"),
      quotation: !!p.proforma_invoice_path,
      coapp:     hasCoapp ? (str(p.coapp_pan) || !!p.coapp_pan_path || !!p.coapp_aadhaar_front_path || !!p.coapp_aadhaar_back_path) : null,
      gst:       null,
      income:    null,
      cheque:    null,
    };
    const have: string[] = [];
    const need: string[] = [];
    for (const [k, v] of Object.entries(status)) {
      if (v === true) have.push(k);
      else if (v === false) need.push(k);
    }
    return { have, need };
  } catch { return { have: [], need: [] }; }
}
