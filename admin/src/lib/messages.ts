// Shared types + content for the "Message to EPC" thread (admin ⇄ EPC), used on
// both the admin profile message window and the EPC portal. Loan + insurance
// share the same shapes; `kind` selects the table/route.

export type MsgKind = "loan" | "insurance";
export type MsgSender = "admin" | "epc";

export type MsgAttachment = { path: string; name: string; mime: string };

export type Message = {
  id: string;
  sender: MsgSender;
  author_id: string | null;
  author_name: string | null;
  body: string | null;
  attachments: MsgAttachment[];
  doc_tags: string[];   // documents this issue is about (multi)
  edited_at: string | null;
  created_at: string;
};

// Attention lifecycle read off the parent profile row.
export type Attention = {
  attention_status: "open" | "resolved" | null;
  attention_raised_at: string | null;
  attention_resolved_at: string | null;
  attention_resolved_by: string | null;
  msg_epc_seen_at: string | null;
  msg_admin_seen_at: string | null;
};

// Documents a loan issue can be tagged against. The value doubles as the
// edit-chatbot picker key, so tagging "aadhaar" opens the EPC's edit straight
// to the Aadhaar row (see /dashboard/apply/chat?…&doc=<tag>).
export const DOC_TAGS: { value: string; label: string }[] = [
  { value: "aadhaar", label: "Aadhaar" },
  { value: "pan", label: "PAN card" },
  { value: "ebill", label: "Electricity bill" },
  { value: "rooftop", label: "Rooftop photo" },
  { value: "selfie", label: "Applicant photo" },
  { value: "bank", label: "Bank statement" },
  { value: "quotation", label: "Quotation" },
  { value: "coapp_aadhaar", label: "Co-applicant Aadhaar" },
  { value: "coapp_pan", label: "Co-applicant PAN" },
  { value: "loan_amount", label: "Loan amount" },
  { value: "install_pincode", label: "Address / pincode" },
];

export function docTagLabel(v: string | null | undefined): string | null {
  if (!v) return null;
  return DOC_TAGS.find((d) => d.value === v)?.label ?? null;
}

// One-tap issue templates. Comprehensive across the documents/fields we ask for;
// the composer stays free-text for anything not listed here. `doc` (optional)
// pre-tags which document the issue is about.
export type MsgTemplate = { label: string; body: string; doc?: string };
export const MSG_TEMPLATES: MsgTemplate[] = [
  { label: "Aadhaar blurred", body: "The Aadhaar photo is blurred / unreadable — please re-upload a clear photo of both sides.", doc: "aadhaar" },
  { label: "Aadhaar address unclear", body: "The address on the Aadhaar back is not readable — please re-upload a clearer photo.", doc: "aadhaar" },
  { label: "PAN name mismatch", body: "The name on the PAN doesn't match the Aadhaar — please check and correct the details.", doc: "pan" },
  { label: "PAN unclear", body: "The PAN card photo is blurred / unreadable — please re-upload a clear photo.", doc: "pan" },
  { label: "Bill not in applicant name", body: "The electricity bill is not in the applicant's name — please add the co-applicant (Aadhaar + PAN).", doc: "ebill" },
  { label: "Bill unclear / old", body: "The electricity bill is unclear or outdated — please upload the latest, clearly readable bill.", doc: "ebill" },
  { label: "Rooftop photo missing", body: "A geo-tagged rooftop photo is required — please capture and upload it at the site.", doc: "rooftop" },
  { label: "Rooftop photo unclear", body: "The rooftop photo is unclear — please re-take a clear, geo-tagged photo at the site.", doc: "rooftop" },
  { label: "Applicant photo needed", body: "The applicant's photo is missing or unclear — please upload a clear photo.", doc: "selfie" },
  { label: "Bank statement incomplete", body: "The bank statement is incomplete — please upload the last 6 months, clearly readable.", doc: "bank" },
  { label: "Quotation missing", body: "The quotation / proforma invoice is missing — please upload it.", doc: "quotation" },
  { label: "Quotation unclear", body: "The quotation is unclear or the project size/cost doesn't match — please re-check and re-upload.", doc: "quotation" },
  { label: "Co-applicant docs needed", body: "Co-applicant Aadhaar and PAN are required for this file — please add them.", doc: "coapp_aadhaar" },
  { label: "Loan amount exceeds cost", body: "The loan amount is higher than the project cost — please correct the loan amount.", doc: "loan_amount" },
  { label: "Address / pincode mismatch", body: "The installation address / pincode doesn't match the documents — please correct it.", doc: "install_pincode" },
  { label: "Docs received, under review", body: "We've received the documents and are reviewing the file — we'll update you shortly.", doc: undefined },
  { label: "Please re-check & resubmit", body: "Please re-check the details and documents, then resubmit the application.", doc: undefined },
];
