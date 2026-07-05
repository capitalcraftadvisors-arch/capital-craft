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

// The five policies bundled behind the single consent checkbox.
// The server ACCEPTS values from this list only.
const POLICIES: { key: string; label: string; blurb: string }[] = [
  { key: "terms_conditions",   label: "Terms & Conditions",  blurb: "The rules governing use of Capital Craft and this loan application." },
  { key: "privacy_policy",     label: "Privacy Policy",      blurb: "How we handle personal data collected during this application." },
  { key: "cookie_policy",      label: "Cookie Policy",       blurb: "Cookies and tracking used across Capital Craft properties." },
  { key: "credit_information", label: "Credit Information",  blurb: "Consent to share application data with credit bureaux and NBFCs." },
  { key: "loan_application",   label: "Loan Application",    blurb: "Consent to the loan application itself and any resulting agreement." },
];
const CONSENT_KEYS = POLICIES.map((p) => p.key);

const SYSTEM_OPTIONS = [
  { value: "off_grid", label: "Off-grid" },
  { value: "on_grid",  label: "On-grid"  },
  { value: "hybrid",   label: "Hybrid"   },
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
  const [panOcrText, setPanOcrText]   = useState<string | null>(null);
  const panExtracted                  = useRef<string | null>(null);

  const [consented, setConsented]     = useState(false);
  const [sending, setSending]         = useState(false);
  const [sendError, setSendError]     = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    void (async () => {
      const { data: la } = await supabase()
        .from("epc_applications")
        .select("id, epc_business_id, status, current_step")
        .eq("id", params.id)
        .maybeSingle();
      if (!la) { setLoading(false); return; }
      setLoan(la as Loan);

      const { data: e } = await supabase()
        .from("epc_business")
        .select("id, epc_display_id, contact_name, trade_name, legal_name")
        .eq("id", (la as Loan).epc_business_id)
        .maybeSingle();
      setEpc(e as Epc | null);
      setLoading(false);
    })();
  }, [params.id]);

  // If the step has already been completed, kick the admin to Step 2
  // (which currently is the placeholder). Prevents re-submission and
  // matches the server-side idempotence guard.
  useEffect(() => {
    if (loan && loan.current_step > 1) {
      router.replace(`/admin/app/${loan.id}/step-2` as any);
    }
  }, [loan, router]);

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

  // PAN OCR runs client-side after upload. Non-fatal: if it fails we
  // still keep the uploaded doc; the PAN number can be filled later.
  async function onPanUploaded(info: { file: File }) {
    setPanUploaded(true);
    try {
      const r = await extractPan(info.file);
      if (r.ok && r.pan) {
        panExtracted.current = r.pan;
        setPanOcrText(r.pan);
      }
    } catch {
      // OCR silent-fail is fine at Step 1.
    }
  }

  const epcName = useMemo(() => {
    if (!epc) return "";
    return epc.trade_name || epc.legal_name || epc.contact_name || "(unnamed EPC)";
  }, [epc]);

  const canSend =
    PIN_RE.test(pin) &&
    state.trim().length > 0 &&
    MOBILE_RE.test(phone) &&
    EMAIL_RE.test(email) &&
    !!systemType &&
    panUploaded &&
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
      // Best-effort: if OCR grabbed a PAN, persist it on the row too.
      if (panExtracted.current) {
        await supabase()
          .from("epc_applications")
          .update({ borrower_pan: panExtracted.current })
          .eq("id", loan.id);
      }
      router.push(`/admin/app/${loan.id}/step-2` as any);
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
          <h1 className="font-display text-[26px] sm:text-[30px] font-bold">Registration</h1>
          <p className="text-text-mid mt-1 text-[14px]">
            Capture the borrower&rsquo;s basic details and record consent. The customer will
            receive a WhatsApp confirmation once you click Send confirmation.
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

        {/* Section: PAN + system type */}
        <Card className="p-6 space-y-4">
          <h2 className="font-display font-semibold text-[16px]">Identity &amp; preference</h2>

          <div>
            <p className="block mb-1.5 text-[13px] font-medium text-text-mid">
              PAN card upload
            </p>
            <FileUpload
              applicationId={loan.id}
              category="borrower_pan"
              table="user_application_docs"
              uploadedBy="admin"
              onUploaded={(info) => void onPanUploaded(info)}
              hint="Image or PDF. Large images are auto-compressed to ~1 MB."
            />
            {panOcrText && (
              <p className="mt-2 text-[12px] text-[#5a8a76]">
                Detected PAN: <span className="font-mono font-semibold text-[#0f3d2e]">{panOcrText}</span>
              </p>
            )}
          </div>

          <div>
            <p className="block mb-1.5 text-[13px] font-medium text-text-mid">
              Solar system preference
            </p>
            <div className="grid sm:grid-cols-3 gap-3">
              {SYSTEM_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={[
                    "border rounded-input px-4 py-3 text-[14px] cursor-pointer transition-colors",
                    systemType === opt.value
                      ? "border-[#178a5c] bg-[#f0faf5] font-semibold text-[#0f3d2e]"
                      : "border-line hover:border-blue",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    name="system_type"
                    value={opt.value}
                    checked={systemType === opt.value}
                    onChange={() => setSystemType(opt.value)}
                    className="mr-2 accent-[#178a5c]"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        </Card>

        {/* Section: consent + send */}
        <Card className="p-6 space-y-4">
          <h2 className="font-display font-semibold text-[16px]">Consent &amp; confirmation</h2>

          <ul className="text-[13px] text-text-mid space-y-1.5 list-disc pl-5">
            {POLICIES.map((p) => (
              <li key={p.key}>
                <span className="font-semibold text-text">{p.label}</span> —{" "}
                <span className="text-text-muted">{p.blurb}</span>
              </li>
            ))}
          </ul>

          <label className="flex items-start gap-2 text-[14px] cursor-pointer">
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              className="mt-1 h-4 w-4 accent-[#178a5c]"
            />
            <span>
              I have read all the documents and policies above and confirm the
              customer&rsquo;s consent to all of them.
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
              Send confirmation
            </Button>
          </div>
        </Card>
      </section>
    </main>
  );
}
