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

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import FileUpload from "@/components/FileUpload";
import { supabase } from "@/lib/supabase";
import { getToken } from "@/lib/auth";
import { extractPan } from "@/lib/ocr";
import { EMAIL_RE, MOBILE_RE } from "@/lib/validators";

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

// Solar system options rendered as three side-by-side clickable cards.
// Each has a heading + short description. Order matches the design spec
// (On-Grid first, then Off-Grid, then Hybrid).
const SYSTEM_CARDS = [
  {
    value: "on_grid",
    title: "On-Grid Solar System",
    desc:  "Connected to electricity grid, can sell excess power",
  },
  {
    value: "off_grid",
    title: "Off-Grid Solar System",
    desc:  "Independent system with battery storage",
  },
  {
    value: "hybrid",
    title: "Hybrid Solar System",
    desc:  "Connected to the grid with battery storage",
  },
] as const;

const PIN_RE = /^[1-9]\d{5}$/;

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
  const [pin, setPin]                 = useState("");
  const [state, setState]             = useState("");
  const [district, setDistrict]       = useState("");
  const [city, setCity]               = useState("");
  const [pinBusy, setPinBusy]         = useState(false);
  const [pinError, setPinError]       = useState<string | null>(null);
  const [pinLocked, setPinLocked]     = useState(false);      // true after successful autofill

  const [phone, setPhone]             = useState("");
  const [email, setEmail]             = useState("");
  const [systemType, setSystemType]   = useState<"off_grid" | "on_grid" | "hybrid" | "">("");
  const [panUploaded, setPanUploaded] = useState(false);
  // PAN number is a proper editable field — OCR prefills, admin can correct.
  const [panNumber, setPanNumber]     = useState("");

  const [consented, setConsented]     = useState(false);
  const [sending, setSending]         = useState(false);
  const [sendError, setSendError]     = useState<string | null>(null);

  // Initial load. Prefills saved values so revisiting/editing this
  // step (via the Step-6 review's Edit links) shows the existing data
  // instead of blanks. No forward-redirect — every step is freely
  // editable from anywhere in the flow.
  useEffect(() => {
    void (async () => {
      const { data: la } = await supabase()
        .from("epc_applications")
        .select(
          "id, epc_business_id, status, current_step, " +
          "install_pincode, install_state, install_district, install_city, " +
          "borrower_mobile, borrower_email, borrower_pan, system_type, consent_at",
        )
        .eq("id", params.id)
        .maybeSingle();
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
      if (row.borrower_pan)     { setPanNumber(row.borrower_pan); setPanUploaded(true); }
      if (row.system_type)      setSystemType(row.system_type);
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

  async function lookupPincode(next: string) {
    setPinError(null);
    setPinLocked(false);
    if (!PIN_RE.test(next)) return;
    setPinBusy(true);
    try {
      const res = await fetch(`/api/admin/pincode-lookup?pin=${next}`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setPinError(data?.error || "Lookup failed — enter state manually.");
        return;
      }
      setState(String(data.state ?? ""));
      setDistrict(String(data.district ?? ""));
      setCity(String(data.city ?? ""));
      setPinLocked(true);
    } catch {
      setPinError("Lookup failed — enter state manually.");
    } finally {
      setPinBusy(false);
    }
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
    } catch {
      // OCR silent-fail is fine — admin fills the PAN box manually.
    }
  }

  const epcName = useMemo(() => {
    if (!epc) return "";
    return epc.trade_name || epc.legal_name || epc.contact_name || "(unnamed EPC)";
  }, [epc]);

  const PAN_FMT_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
  const panValid = PAN_FMT_RE.test(panNumber.trim().toUpperCase());

  const canSend =
    PIN_RE.test(pin) &&
    state.trim().length > 0 &&
    MOBILE_RE.test(phone) &&
    EMAIL_RE.test(email) &&
    !!systemType &&
    panUploaded &&
    panValid &&
    consented &&
    !sending;

  async function send() {
    if (!canSend || !loan) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/admin/loan-app/${loan.id}/complete-step-1`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken() ?? ""}`,
        },
        body: JSON.stringify({
          install_pincode:  pin,
          install_state:    state,
          install_district: district || null,
          install_city:     city || null,
          borrower_mobile:  phone,
          borrower_email:   email,
          borrower_pan:     panNumber.trim().toUpperCase(),
          system_type:      systemType,
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
      const fromReview = new URLSearchParams(window.location.search).get("from") === "review";
      router.push(`/admin/app/${loan.id}/${fromReview ? "step-6" : "step-2"}` as any);
    } catch (e) {
      setSendError((e as Error)?.message || "Network error.");
      setSending(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen grid place-items-center">
        <p className="text-text-muted">Loading…</p>
      </main>
    );
  }
  if (!loan || !epc) {
    return (
      <main className="min-h-screen grid place-items-center">
        <p className="text-red-700">Loan application not found.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white">
        <div className="w-full px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-display font-bold text-[20px] grad-text">Capital Craft</span>
            <span className="text-[12px] px-2 py-0.5 rounded-full bg-bg-tint text-blue-dark font-semibold uppercase tracking-wide">
              Loan Application · Step 1
            </span>
          </div>
          <a href="/admin" className="text-[13px] text-text-muted hover:text-text">← Back to console</a>
        </div>
      </header>

      <section className="max-w-[880px] mx-auto px-5 sm:px-7 py-10 space-y-5">
        <div>
          <h1 className="font-display text-[28px] sm:text-[32px] font-bold text-[#0f3d2e]">
            Registration
          </h1>
          <p className="text-text-mid mt-2 text-[15px]">
            Capture the customer&rsquo;s basic details, upload their PAN card, and record
            consent. All fields on this page are editable — OCR-detected values are
            prefilled but you can correct anything before saving.
          </p>
        </div>

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
            onClick={() => router.push("/admin")}
            className="text-[12px] text-[#178a5c] hover:underline"
          >
            Change EPC
          </button>
        </Card>

        {/* Section: installation location */}
        <Card className="p-6 space-y-4">
          <h2 className="font-display font-semibold text-[16px]">Installation site</h2>

          <div className="grid sm:grid-cols-2 gap-4">
            <Input
              label="Pincode (installation address)"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              onBlur={(e) => void lookupPincode(e.target.value)}
              placeholder="6-digit pincode"
              error={pinError ?? undefined}
              hint={pinBusy ? "Looking up state…" : undefined}
            />

            <Input
              label="Installation state"
              value={state}
              onChange={(e) => setState(e.target.value)}
              readOnly={pinLocked && !pinError}
              placeholder={pinBusy ? "Fetching…" : "State"}
              hint={
                pinLocked && !pinError
                  ? "Auto-filled from pincode. Manual override on lookup failure."
                  : "If auto-fill fails, enter the state manually."
              }
            />
          </div>

          {(district || city) && (
            <div className="text-[12px] text-text-mid">
              District: <span className="font-semibold text-text">{district || "—"}</span> ·{" "}
              Area: <span className="font-semibold text-text">{city || "—"}</span>
            </div>
          )}
        </Card>

        {/* Section: customer contact */}
        <Card className="p-6 space-y-4">
          <h2 className="font-display font-semibold text-[16px]">Customer contact</h2>

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
          </div>
        </Card>

        {/* Section: PAN card — upload + editable PAN number in a proper box. */}
        <Card className="p-6 space-y-5">
          <div>
            <h2 className="font-display font-semibold text-[18px] text-[#0f3d2e]">PAN card</h2>
            <p className="text-[13px] text-text-mid mt-1">
              Upload the PAN card, then confirm the number OCR pulled out. Correct it if wrong.
            </p>
          </div>

          <div>
            <p className="block mb-1.5 text-[13px] font-medium text-text-mid">
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
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#f0faf5] text-[#0f3d2e] font-semibold uppercase tracking-wide border border-[#cdeadd]">
                  {panNumber ? "Extracted" : "Enter manually"}
                </span>
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
        </Card>

        {/* Section: Solar system preference — three side-by-side clickable
            cards. Whole card is the click target; radio indicator in the
            top-right corner. Selected state uses the brand green palette. */}
        <Card className="p-6 space-y-4">
          <h2 className="font-display font-semibold text-[16px]">Solar system preference</h2>

          <div className="grid sm:grid-cols-3 gap-3">
            {SYSTEM_CARDS.map((opt) => {
              const active = systemType === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSystemType(opt.value)}
                  className={[
                    "text-left rounded-input border-2 p-4 transition-colors relative",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#185fa5]",
                    active
                      ? "border-[#178a5c] bg-[#f0faf5]"
                      : "border-line bg-white hover:border-[#185fa5]",
                  ].join(" ")}
                >
                  {/* Radio indicator — top-right corner */}
                  <span
                    className={[
                      "absolute top-3 right-3 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors",
                      active ? "border-[#178a5c]" : "border-line",
                    ].join(" ")}
                    aria-hidden
                  >
                    {active && (
                      <span className="w-2 h-2 rounded-full bg-[#178a5c]" />
                    )}
                  </span>

                  <p
                    className={[
                      "font-display font-semibold text-[14px] pr-6",
                      active ? "text-[#0f3d2e]" : "text-text",
                    ].join(" ")}
                  >
                    {opt.title}
                  </p>
                  <p className="text-[12px] text-text-muted mt-1">
                    {opt.desc}
                  </p>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Section: consent line + Next */}
        <Card className="p-6 space-y-4">
          <h2 className="font-display font-semibold text-[16px]">Consent &amp; authorization</h2>

          <label className="flex items-start gap-3 text-[14px] leading-relaxed cursor-pointer">
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-[#178a5c]"
            />
            <span className="text-text">
              By clicking here, I state that I have read and understood the{" "}
              <a href="#" target="_blank" rel="noopener" className="text-[#185fa5] hover:underline font-medium">
                Terms and Conditions
              </a>
              ,{" "}
              <a href="#" target="_blank" rel="noopener" className="text-[#185fa5] hover:underline font-medium">
                Privacy Policy
              </a>{" "}
              and{" "}
              <a href="#" target="_blank" rel="noopener" className="text-[#185fa5] hover:underline font-medium">
                Cookie Policy
              </a>{" "}
              and Allow{" "}
              <span className="font-semibold">Capital Craft Financial Advisors</span>{" "}
              and its lending partners to access my credit information.
            </span>
          </label>

          {sendError && (
            <div className="p-3 rounded-input bg-red-50 border border-red-200 text-[13px] text-red-700">
              {sendError}
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button
              type="button"
              variant="primary"
              onClick={send}
              loading={sending}
              disabled={!canSend}
            >
              Next
            </Button>
          </div>
        </Card>
      </section>
    </main>
  );
}
