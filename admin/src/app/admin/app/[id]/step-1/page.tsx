"use client";

// Loan Application — Step 1 (Registration)
//
// Admin fills the borrower's basic details on behalf of the customer.
// Layout mirrors the EPC onboarding aesthetic (brand palette, Card,
// standard Input/Select). Reused pieces:
//   - FileUpload / /api/upload  for the PAN card (auto-compressed).
//   - extractPan()              for OCR on the uploaded image.
//   - /api/admin/pincode-lookup for auto-filling installation state.
//   - sendWhatsAppConfirmation  (via server route) as the send stub.
//
// Flow ends by PATCHing /api/admin/loan-app/[id]/complete-step-1,
// which records consent, fires the WhatsApp stub, and advances
// current_step to 2. Client then routes to /admin/app/[id]/step-2.
//
// The page frame, section cards, choice cards, consent row and the pincode
// lookup come from the shared loan-form kit (components/loan-form).

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import FileUpload from "@/components/FileUpload";
import { supabase } from "@/lib/supabase";
import { authHeaders } from "@/lib/auth";
import { extractPan } from "@/lib/ocr";
import { EMAIL_RE, MOBILE_RE, PAN_RE, PINCODE_RE } from "@/lib/validators";
import { aadhaarFaceCountsAsPhoto } from "@/lib/applicant-photo";
import {
  StepHeader, StepLoading, StepNotFound, StepTitle,
  FormSection, H18, FIELD_LABEL, ErrorBox, GreenPill, CheckRow, PolicyLink,
  SystemChoice, PlantUseChoice, INCOMPLETE_NOTE, PincodeFields, usePincode, nextStepPath,
} from "@/components/loan-form";

// The five policy keys recorded in the consent legal breadcrumb. The
// visible consent line mentions three by name (Terms / Privacy / Cookie)
// plus body text covering credit-information sharing and the loan
// application itself — so ticking the box implies all five. We record
// all five server-side to keep the legal record stronger.
const CONSENT_KEYS = [
  "terms_conditions",
  "privacy_policy",
  "cookie_policy",
  "credit_information",
  "loan_application",
];

type Epc = {
  id: string;
  epc_display_id: string | null;
  contact_name: string | null;
  trade_name: string | null;
  legal_name: string | null;
};

type Loan = {
  id: string;
  epc_business_id: string;
  status: string;
  current_step: number;
};

export default function LoanAppStep1Page() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [loan, setLoan] = useState<Loan | null>(null);
  const [epc, setEpc]   = useState<Epc | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const pincode = usePincode();
  const { pin, setPin, state, setState, district, setDistrict, city, setCity } = pincode;

  const [phone, setPhone]             = useState("");
  const [email, setEmail]             = useState("");
  const [leadOwner, setLeadOwner]     = useState("");   // lead_owner_name (migration 0074)
  const [systemType, setSystemType]   = useState<"off_grid" | "on_grid" | "hybrid" | "">("");
  const [plantUse, setPlantUse]       = useState<"residential" | "commercial" | "">("");
  const [panUploaded, setPanUploaded] = useState(false);
  // PAN number is a proper editable field — OCR prefills, admin can correct.
  const [panNumber, setPanNumber]     = useState("");
  // Father's name — read from the PAN OCR, editable. Persisted to
  // borrower_father_name (migration 0050).
  const [panFatherName, setPanFatherName] = useState("");
  // Applicant passport-size photo (registration step only).
  const [photoUploaded, setPhotoUploaded] = useState(false);
  const [photoPath, setPhotoPath]         = useState<string | null>(null);

  const [consented, setConsented]     = useState(false);
  const [sending, setSending]         = useState(false);
  const [sendError, setSendError]     = useState<string | null>(null);

  // Change EPC — an in-place picker over APPROVED EPCs. Re-points the
  // application's epc_business_id without leaving the form (previously the
  // button just bounced to the console list).
  const [epcPickOpen, setEpcPickOpen] = useState(false);
  const [epcList, setEpcList]         = useState<Epc[]>([]);
  const [epcSearch, setEpcSearch]     = useState("");
  const [epcBusy, setEpcBusy]         = useState(false);

  // Initial load. Prefills saved values so revisiting/editing this
  // step (via the Step-6 review's Edit links) shows the existing data
  // instead of blanks. No forward-redirect — every step is freely
  // editable from anywhere in the flow.
  useEffect(() => {
    void (async () => {
      const STEP1_COLS =
        "id, epc_business_id, status, current_step, " +
        "install_pincode, install_state, install_district, install_city, " +
        "borrower_mobile, borrower_email, borrower_pan, borrower_father_name, system_type, plant_use_type, consent_at, customer_photo_path, created_at, aadhaar_face_path";
      const q = (cols: string) => supabase().from("epc_applications").select(cols).eq("id", params.id).maybeSingle();
      // lead_owner_name lands with migration 0074 — until the column exists in
      // prod (42703 = undefined column), load the step without it.
      let res = await q(`${STEP1_COLS}, lead_owner_name`);
      if (res.error?.code === "42703") res = await q(STEP1_COLS);
      const la = res.data;
      if (!la) { setLoading(false); return; }
      const row = la as unknown as Loan & Record<string, any>;
      setLoan(row);
      // Prefill from prior save (edit / resume pass).
      if (row.install_pincode)  setPin(row.install_pincode);
      if (row.install_state)    setState(row.install_state);
      if (row.install_district) setDistrict(row.install_district);
      if (row.install_city)     setCity(row.install_city);
      if (row.borrower_mobile)  setPhone(row.borrower_mobile);
      if (row.borrower_email)   setEmail(row.borrower_email);
      if (row.lead_owner_name)  setLeadOwner(row.lead_owner_name);
      if (row.borrower_pan)     { setPanNumber(row.borrower_pan); setPanUploaded(true); }
      if (row.borrower_father_name) setPanFatherName(row.borrower_father_name);
      if (row.customer_photo_path) { setPhotoPath(row.customer_photo_path); setPhotoUploaded(true); }
      // Grandfathered profiles (created before the passport-photo cutover) count
      // the Aadhaar face as the applicant photo — don't force a re-upload.
      else if (aadhaarFaceCountsAsPhoto({ created_at: row.created_at, aadhaar_face_path: row.aadhaar_face_path })) { setPhotoUploaded(true); }
      if (row.system_type)      setSystemType(row.system_type);
      if (row.plant_use_type)   setPlantUse(row.plant_use_type);
      if (row.consent_at)       setConsented(true);

      const { data: e } = await supabase()
        .from("epc_business")
        .select("id, epc_display_id, contact_name, trade_name, legal_name")
        .eq("id", row.epc_business_id)
        .maybeSingle();
      setEpc(e as Epc | null);
      setLoading(false);
    })();
  }, [params.id]);

  async function openEpcPicker() {
    setEpcSearch(""); setEpcPickOpen(true);
    if (epcList.length) return; // already loaded
    const { data } = await supabase()
      .from("epc_business")
      .select("id, epc_display_id, contact_name, trade_name, legal_name")
      .neq("business_type", "admin")
      .eq("status", "approved")
      .order("trade_name", { ascending: true, nullsFirst: false })
      .order("legal_name", { ascending: true, nullsFirst: false });
    setEpcList((data ?? []) as Epc[]);
  }
  async function chooseEpc(next: Epc) {
    if (!loan || epcBusy) return;
    setEpcBusy(true); setSendError(null);
    try {
      const { error } = await supabase().from("epc_applications").update({ epc_business_id: next.id }).eq("id", loan.id);
      if (error) { setSendError(error.message); return; }
      setLoan({ ...loan, epc_business_id: next.id });
      setEpc(next);
      setEpcPickOpen(false);
    } finally { setEpcBusy(false); }
  }

  // PAN OCR runs client-side after upload. Prefills the editable PAN
  // Number input — admin can always correct or type manually.
  async function onPanUploaded(info: { file: File }) {
    setPanUploaded(true);
    try {
      const r = await extractPan(info.file);
      if (r.ok && r.pan && !panNumber) {
        setPanNumber(r.pan);
      }
      if (r.ok && r.father_name && !panFatherName) {
        setPanFatherName(r.father_name);
      }
    } catch {
      // OCR silent-fail is fine — admin fills the PAN box manually.
    }
  }

  const epcName = useMemo(() => {
    if (!epc) return "";
    return epc.trade_name || epc.legal_name || epc.contact_name || "(unnamed EPC)";
  }, [epc]);

  const panValid = PAN_RE.test(panNumber.trim().toUpperCase());

  const canSend =
    PINCODE_RE.test(pin) &&
    state.trim().length > 0 &&
    MOBILE_RE.test(phone) &&
    EMAIL_RE.test(email) &&
    !!systemType &&
    !!plantUse &&
    panUploaded &&
    panValid &&
    photoUploaded &&
    consented &&
    !sending;

  async function send() {
    // Admin-only flow: never block on missing fields — save whatever's there.
    if (!loan) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/admin/loan-app/${loan.id}/complete-step-1`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          install_pincode:  pin,
          install_state:    state,
          install_district: district || null,
          install_city:     city || null,
          borrower_mobile:  phone,
          borrower_email:   email,
          borrower_pan:     panNumber.trim().toUpperCase(),
          borrower_father_name: panFatherName.trim() || null,
          lead_owner_name:  leadOwner.trim() || null,
          customer_photo_path: photoPath,
          system_type:      systemType,
          plant_use_type:   plantUse,
          consent_policies: CONSENT_KEYS,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setSendError(data?.error || `HTTP ${res.status}`);
        setSending(false);
        return;
      }
      // Came here via a Step-6 "Edit" link? Go back to the review.
      router.push(nextStepPath(loan.id, "step-2") as any);
    } catch (e) {
      setSendError((e as Error)?.message || "Network error.");
      setSending(false);
    }
  }

  if (loading) return <StepLoading />;
  if (!loan || !epc) return <StepNotFound />;

  return (
    <main className="min-h-screen bg-bg-soft">
      <StepHeader step={1} backTo={`/admin/app/${params.id}/view`} backLabel="Back to previous page">
        <a href="/admin" className="text-[13px] text-text-muted hover:text-text">← Back to console</a>
      </StepHeader>

      <section className="max-w-[880px] mx-auto px-5 sm:px-7 py-10 space-y-5">
        <StepTitle title="Registration">
          Capture the customer&rsquo;s basic details, upload their PAN card, and record
          consent. All fields on this page are editable — OCR-detected values are
          prefilled but you can correct anything before saving.
        </StepTitle>

        {/* EPC banner */}
        <Card className="p-4 flex items-center justify-between flex-wrap gap-3 bg-[#f0faf5] border-[#cdeadd]">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[#5a8a76] font-semibold">Selected EPC</p>
            <p className="font-display text-[16px] font-bold text-[#0f3d2e] mt-0.5">
              {epcName}
              {epc.epc_display_id && (
                <span className="ml-2 text-[12px] font-mono font-normal text-[#5a8a76]">{epc.epc_display_id}</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void openEpcPicker()}
            className="text-[12px] text-[#178a5c] hover:underline"
          >
            Change EPC
          </button>
        </Card>

        {epcPickOpen && (
          <Modal onClose={() => setEpcPickOpen(false)} busy={epcBusy} className="w-full max-w-md bg-white rounded-lg shadow-lg p-5">
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-display font-semibold text-[18px] text-text">Change EPC</h3>
              <button type="button" onClick={() => setEpcPickOpen(false)} disabled={epcBusy} aria-label="Close"
                className="text-[18px] text-text-muted hover:text-text leading-none disabled:opacity-40">×</button>
            </div>
            <input
              autoFocus
              value={epcSearch}
              onChange={(e) => setEpcSearch(e.target.value)}
              placeholder="Search approved EPCs…"
              className="w-full rounded-input border border-line bg-white px-3 py-2 text-[14px] outline-none focus:border-blue mb-2"
            />
            <div className="max-h-[50vh] overflow-y-auto flex flex-col border border-line rounded-input">
              {(() => {
                if (!epcList.length) return <div className="text-[13px] text-text-muted px-3 py-3">Loading partners…</div>;
                const q = epcSearch.trim().toLowerCase();
                const rows = epcList.filter((e) => !q || `${e.trade_name ?? ""} ${e.legal_name ?? ""} ${e.contact_name ?? ""} ${e.epc_display_id ?? ""}`.toLowerCase().includes(q));
                if (!rows.length) return <div className="text-[13px] text-text-muted px-3 py-3">No approved EPC matches.</div>;
                return rows.map((e) => (
                  <button key={e.id} type="button" disabled={epcBusy} onClick={() => void chooseEpc(e)}
                    className={["text-left px-3 py-2.5 border-b border-line/60 last:border-0 hover:bg-[#f7fcf9] transition disabled:opacity-60", e.id === loan?.epc_business_id ? "bg-[#f0faf5]" : ""].join(" ")}>
                    <div className="text-[14px] font-semibold text-text">{e.trade_name || e.legal_name || e.contact_name || "(unnamed EPC)"}</div>
                    {e.epc_display_id && <div className="text-[12px] text-text-muted font-mono">{e.epc_display_id}</div>}
                  </button>
                ));
              })()}
            </div>
          </Modal>
        )}

        {/* Section: installation location */}
        <FormSection title="Installation site">

          <PincodeFields
            p={pincode}
            pinPlaceholder="6-digit pincode"
            stateReadOnly={pincode.locked && !pincode.error}
            stateHint={
              pincode.locked && !pincode.error
                ? "Auto-filled from pincode. Manual override on lookup failure."
                : "If auto-fill fails, enter the state manually."
            }
          />

          {(district || city) && (
            <div className="text-[12px] text-text-mid">
              District: <span className="font-semibold text-text">{district || "—"}</span> ·{" "}
              Area: <span className="font-semibold text-text">{city || "—"}</span>
            </div>
          )}
        </FormSection>

        {/* Section: customer contact */}
        <FormSection title="Customer contact">

          <div className="grid sm:grid-cols-2 gap-4">
            <Input
              label="Customer phone number"
              inputMode="numeric"
              maxLength={10}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              placeholder="10-digit mobile"
              hint="No verification here — the WhatsApp confirmation goes to this number."
            />
            <Input
              label="Email ID"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@example.com"
              hint="No email verification at this step."
            />
            <Input
              label="Lead owner name"
              value={leadOwner}
              onChange={(e) => setLeadOwner(e.target.value)}
              placeholder="Who owns this lead"
            />
          </div>
        </FormSection>

        {/* Section: PAN card — upload + editable PAN number in a proper box. */}
        <FormSection
          title="PAN card"
          subtitle="Upload the PAN card, then confirm the number OCR pulled out. Correct it if wrong."
          className="p-6 space-y-5"
          titleClassName={H18}
        >
          <div>
            <p className={FIELD_LABEL}>
              Upload the customer&rsquo;s PAN card
            </p>
            <FileUpload
              applicationId={loan.id}
              category="borrower_pan"
              table="user_application_docs"
              uploadedBy="admin"
              onUploaded={(info) => void onPanUploaded(info)}
              hint="Photo, scan, or PDF."
            />
          </div>

          {/* Proper editable PAN Number field — prefilled from OCR when detected. */}
          <div className="rounded-input border-2 border-line bg-[#f8fafc] p-4">
            <div className="flex items-baseline justify-between mb-2">
              <label className="text-[13px] font-semibold text-text">
                PAN Number
              </label>
              {panUploaded && (
                <GreenPill>{panNumber ? "Extracted" : "Enter manually"}</GreenPill>
              )}
            </div>
            <input
              type="text"
              value={panNumber}
              onChange={(e) => setPanNumber(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))}
              placeholder="AAAAA9999A"
              maxLength={10}
              className={[
                "w-full rounded-input border-2 px-4 py-3 text-[16px] font-mono tracking-wider outline-none transition-colors bg-white",
                panNumber && !panValid
                  ? "border-red-400 focus:border-red-500"
                  : panValid
                  ? "border-[#178a5c] focus:border-[#178a5c]"
                  : "border-line focus:border-[#185fa5]",
              ].join(" ")}
            />
            <p className="mt-2 text-[11px] text-text-muted">
              Format: 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F).
              {panNumber && !panValid && " Invalid format."}
            </p>
          </div>

          {/* Father's name — prefilled from the PAN OCR, editable. */}
          <div className="rounded-input border-2 border-line bg-[#f8fafc] p-4">
            <label className="text-[13px] font-semibold text-text block mb-2">
              Father&rsquo;s name <span className="font-normal text-text-muted">(from PAN)</span>
            </label>
            <input
              type="text"
              value={panFatherName}
              onChange={(e) => setPanFatherName(e.target.value)}
              placeholder="As printed on the PAN card"
              className="w-full rounded-input border-2 border-line focus:border-[#185fa5] px-4 py-3 text-[15px] outline-none transition-colors bg-white"
            />
          </div>
        </FormSection>

        {/* Section: Applicant photo — passport-size, captured at registration. */}
        <FormSection
          title="Applicant photo"
          subtitle="Upload a recent passport-size photograph of the applicant."
          titleClassName={H18}
        >
          <FileUpload
            applicationId={loan.id}
            category="customer_photo"
            table="user_application_docs"
            uploadedBy="admin"
            onUploaded={(info) => { setPhotoUploaded(true); setPhotoPath(info.storagePath); }}
            hint="Clear, front-facing photo — JPG or PNG."
          />
        </FormSection>

        {/* Section: Solar system preference — three side-by-side clickable
            cards. Whole card is the click target; radio indicator in the
            top-right corner. Selected state uses the brand green palette. */}
        <FormSection title="Solar system preference">
          <SystemChoice value={systemType} onPick={setSystemType} />

          {/* Residential / Commercial — required */}
          <PlantUseChoice value={plantUse} onPick={setPlantUse} className="pt-4 border-t border-line" />
        </FormSection>

        {/* Section: consent line + Next */}
        <FormSection title="Consent & authorization">
          <CheckRow checked={consented} onChange={setConsented} className="flex items-start gap-3 text-[14px] leading-relaxed cursor-pointer">
            By clicking here, I state that I have read and understood the{" "}
            <PolicyLink>
              Terms and Conditions
            </PolicyLink>
            ,{" "}
            <PolicyLink>
              Privacy Policy
            </PolicyLink>{" "}
            and{" "}
            <PolicyLink>
              Cookie Policy
            </PolicyLink>{" "}
            and Allow{" "}
            <span className="font-semibold">Capital Craft Financial Advisors</span>{" "}
            and its lending partners to access my credit information.
          </CheckRow>

          <ErrorBox message={sendError} />

          <div className="flex flex-col items-end gap-2 pt-2">
            {!canSend && (
              <p className="text-[12px] text-amber-600">
                {INCOMPLETE_NOTE}
              </p>
            )}
            <Button
              type="button"
              variant="primary"
              onClick={send}
              loading={sending}
              disabled={sending}
            >
              Next
            </Button>
          </div>
        </FormSection>
      </section>
    </main>
  );
}
