"use client";

// Loan Application — full-page dense 3-column dashboard for admin.
//
// This page is a STRUCTURAL COPY of the EPC View
// (admin/src/app/admin/epc/[id]/view/page.tsx). Same shell, same header card,
// same status band shape, same progress tracker, same 3-column grid, same
// actions strip, same modals — only the DATA and the labels differ.
//
// Every piece of chrome comes from @/components/view/ViewKit, which is the
// SAME kit the EPC View imports. Do NOT re-implement layout/CSS here: change
// ViewKit instead, and both dashboards move together. Re-implementing the
// chrome by hand is exactly what made these two pages drift apart before.
//
// Read-only summary — "Edit application" jumps to /admin/app/[id]/step-1
// (every step stays editable, nothing is locked, even after submit).

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import { getToken, getBusiness } from "@/lib/auth";
import { getDocumentUrl } from "@/lib/storage";
import DeleteLoanAppModal from "@/components/DeleteLoanAppModal";
import CommentsSection from "@/components/CommentsSection";
import LoanActivityLogModal from "@/components/LoanActivityLogModal";
import LenderDecisionModal from "@/components/LenderDecisionModal";
import ApprovalDetailsTable, { LENDER_LABEL, type ApprovalDetails } from "@/components/ApprovalDetailsTable";
import LenderPickerModal, { type LenderKey } from "@/components/LenderPickerModal";
import { logLoanActivity } from "@/lib/loanAudit";
import {
  I, StatusBtn, Pill, BigProgressStep, BigConnector, SectionCard, KV,
  StepBlock, DocGrid, type ViewDocSlot,
} from "@/components/view/ViewKit";

type Loan = Record<string, any>;
type Doc  = { id: string; category: string; storage_path: string; file_name: string | null; mime_type: string | null };

const SYSTEM_LABEL: Record<string, string> = {
  on_grid:  "On-Grid",
  off_grid: "Off-Grid",
  hybrid:   "Hybrid",
};
const EMPLOYMENT_LABEL: Record<string, string> = {
  salaried: "Salaried", self_employed: "Self-employed",
};
const METHOD_LABEL: Record<string, string> = {
  manual_epdf: "Manual E-PDF Upload", scanned_pdf: "Scanned PDF Upload",
};
// Loan applications have exactly one status — the lender outcome. There is no
// separate "internal" status the way EPC profiles have.
const LOAN_STATUS_LABEL: Record<string, string> = {
  draft:        "Draft",
  submitted:    "Submitted",
  under_review: "Under Review",
  approved:     "Approved by lender",
  rejected:     "Rejected by lender",
};
// Friendly labels for user_application_docs categories not covered by an
// expected slot (surfaced under "Other documents").
const DOC_LABEL: Record<string, string> = {
  customer_photo:   "Applicant photo",
  borrower_photo:   "Rooftop photo",
  borrower_pan:     "PAN card",
  borrower_aadhaar: "Aadhaar",
  quotation:        "Quotation / Proforma",
  electricity_bill: "Electricity bill",
  bank_statement:   "Bank statement",
  income_proof:     "Income proof",
  property_doc:     "Property document",
};

// Prefers the stored loan_display_id (CC-RES/CC-COM-#####, migration 0036);
// uuid-derived fallback for rows created before the format landed (or with no
// plant_use_type, which is what assigns the sequence).
function displayId(loan: Loan): string {
  if (loan.loan_display_id) return loan.loan_display_id;
  return "LA-" + String(loan.id).replace(/-/g, "").slice(0, 8).toUpperCase();
}
function fmtRupees(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return "₹" + Math.round(Number(n)).toLocaleString("en-IN");
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function maskAcct(a: string | null | undefined): string {
  if (!a) return "—";
  if (a.length <= 4) return "•".repeat(6) + a;
  return "•".repeat(Math.max(6, a.length - 4)) + a.slice(-4);
}
function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ── Document grouping (missing-doc visibility) ───────────────────────
//
// The loan flow stores documents two ways: some as user_application_docs rows
// (borrower_pan, customer_photo, borrower_photo, quotation — viewed via
// openDoc/id) and the rest as *_path columns on the epc_applications row
// (Aadhaar, e-bill, proforma, bank statement, co-applicant — viewed by path
// via openPath). This builds the full expected set grouped by step so missing
// documents render greyed as "Not uploaded" beside the uploaded ones.

type LoanSlot = { key: string; label: string; docId: string | null; path: string | null };
type LoanDocGroup = { title: string; slots: LoanSlot[] };

function buildLoanDocGroups(loan: Loan, docs: Doc[]): LoanDocGroup[] {
  const usedRowIds = new Set<string>();
  const slot = (
    key: string, label: string, cats: string[], path: string | null | undefined,
  ): LoanSlot => {
    for (const cat of cats) {
      const row = docs.find((d) => d.category === cat && !usedRowIds.has(d.id));
      if (row) { usedRowIds.add(row.id); return { key, label, docId: row.id, path: null }; }
    }
    return { key, label, docId: null, path: path ?? null };
  };

  const groups: LoanDocGroup[] = [];

  groups.push({
    title: "Identity (Steps 1–2)",
    slots: [
      slot("applicant_pan",   "Applicant PAN card", ["borrower_pan"],   null),
      slot("applicant_photo", "Applicant photo",    ["customer_photo"], loan.customer_photo_path),
      slot("aadhaar_front",   "Aadhaar (front)",    [], loan.aadhaar_front_path),
      slot("aadhaar_back",    "Aadhaar (back)",     [], loan.aadhaar_back_path),
    ],
  });

  groups.push({
    title: "Loan requirement (Step 3)",
    slots: [
      slot("quotation", "Quotation / Proforma invoice", ["quotation"],        loan.proforma_invoice_path),
      slot("ebill",     "Electricity bill",             ["electricity_bill"], loan.ebill_path),
      slot("rooftop",   "Rooftop photo",                ["borrower_photo"],   loan.rooftop_photo_path),
    ],
  });

  const hasCoapp = loan.bill_on_applicant_name === false ||
    !!(loan.coapp_pan_path || loan.coapp_aadhaar_front_path || loan.coapp_aadhaar_back_path);
  if (hasCoapp) {
    groups.push({
      title: "Co-applicant (Step 3)",
      slots: [
        slot("coapp_pan",           "Co-applicant PAN card",        [], loan.coapp_pan_path),
        slot("coapp_aadhaar_front", "Co-applicant Aadhaar (front)", [], loan.coapp_aadhaar_front_path),
        slot("coapp_aadhaar_back",  "Co-applicant Aadhaar (back)",  [], loan.coapp_aadhaar_back_path),
      ],
    });
  }

  groups.push({
    title: "Financial (Step 4)",
    slots: [
      slot("bank_statement", "Bank statement", ["bank_statement"], loan.bank_statement_path),
    ],
  });

  const others = docs.filter((d) => !usedRowIds.has(d.id));
  if (others.length > 0) {
    groups.push({
      title: "Other documents",
      slots: others.map((d) => ({
        key: `other-${d.id}`,
        label: DOC_LABEL[d.category] ?? d.category.replace(/_/g, " "),
        docId: d.id,
        path: null,
      })),
    });
  }

  return groups;
}

export default function LoanAppViewPage() {
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
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [zipPickerOpen, setZipPickerOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      const [{ data: la }, { data: dd }] = await Promise.all([
        supabase().from("epc_applications")
          .select("*, epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)")
          .eq("id", params.id)
          .maybeSingle(),
        supabase().from("user_application_docs")
          .select("id, category, storage_path, file_name, mime_type")
          .eq("application_id", params.id),
      ]);
      setLoan(la);
      const docRows = (dd ?? []) as Doc[];
      setDocs(docRows);
      setLoading(false);

      // Sign the applicant's passport photo for the header avatar.
      const photoDoc = docRows.find((d) => d.category === "customer_photo");
      if (photoDoc) {
        const url = await getDocumentUrl(photoDoc.id);
        if (url) setPhotoUrl(url);
      }
    })();
  }, [params.id]);

  const applicantName = useMemo(
    () => loan?.borrower_name || loan?.aadhaar_name || "(unnamed applicant)",
    [loan],
  );
  const epcName = useMemo(() => {
    if (!loan?.epc_business) return "—";
    return loan.epc_business.trade_name || loan.epc_business.legal_name || loan.epc_business.contact_name || "—";
  }, [loan]);
  const docGroups = useMemo(() => (loan ? buildLoanDocGroups(loan, docs) : []), [loan, docs]);

  async function openDoc(id: string) {
    const url = await getDocumentUrl(id);
    if (url) window.open(url, "_blank", "noopener");
  }

  // View a document stored as a *_path column (Aadhaar, e-bill, proforma,
  // bank statement, co-applicant) — these have no user_application_docs row,
  // so they're signed by path via the admin-only sign-doc route.
  async function openPath(path: string) {
    try {
      const res = await fetch(`/api/admin/loan-app/${params.id}/sign-doc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ path }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok && data.url) window.open(data.url, "_blank", "noopener");
    } catch {
      /* ignore — the eye icon just won't open */
    }
  }

  // Map a group's slots onto the shared ViewKit DocGrid slots: a row-backed
  // doc opens by id, a column-path doc opens by path, neither → "Not uploaded".
  function toViewSlots(g: LoanDocGroup): ViewDocSlot[] {
    return g.slots.map((s) => ({
      key: s.key,
      label: s.label,
      onView: s.docId
        ? () => void openDoc(s.docId!)
        : s.path
        ? () => void openPath(s.path!)
        : undefined,
    }));
  }

  // Plain status move (used for "Mark under review" / re-open). Approval and
  // rejection go through their own flows below — they also record WHICH
  // lender decided. Every change appends to status_history and writes a
  // loan_activity_log row so the Activity log has the trail.
  async function changeStatus(next: "under_review" | "approved" | "rejected", extra: Record<string, unknown> = {}, note = "") {
    if (!loan || statusBusy) return;
    setStatusBusy(true);
    setStatusMsg(null);
    const me = getBusiness();
    const by = me?.contact_name || "admin";
    const now = new Date().toISOString();
    const entry = { from: loan.status ?? "", to: next, by, at: now, note };
    const history = Array.isArray(loan.status_history) ? [...loan.status_history, entry] : [entry];
    const patch = { status: next, status_history: history, reviewed_by: by, reviewed_at: now, ...extra };
    const { error } = await supabase().from("epc_applications").update(patch).eq("id", loan.id);
    if (error) {
      setStatusMsg("Couldn't update status — " + error.message);
      setStatusBusy(false);
      return;
    }
    setLoan({ ...loan, ...patch });
    setStatusMsg("Status updated.");
    await logLoanActivity(loan.id, next === "approved" ? "approved" : next === "rejected" ? "rejected" : "status_change", {
      detail: note || `Status → ${LOAN_STATUS_LABEL[next] ?? next}`,
    });
    setStatusBusy(false);
  }

  // APPROVAL — popup picked a lender + confirmed. Hand off to the approval
  // details screen; the status is written there, on Save, together with the
  // filled table (so a half-finished approval never lands).
  function onApproveConfirm(lender: LenderKey) {
    if (!loan) return;
    router.push(`/admin/app/${loan.id}/approval?lender=${lender}` as any);
  }

  // REJECTION — no table; record the lender + flip the status immediately.
  async function onRejectConfirm(lender: LenderKey) {
    if (!loan) return;
    await changeStatus(
      "rejected",
      { rejected_lender: lender, rejected_at: new Date().toISOString(), approved_lender: null, approved_at: null },
      `Rejected by ${LENDER_LABEL[lender] ?? lender}`,
    );
  }

  // The ZIP is lender-specific (the Excel stamps "Submitted to"), so the
  // picker popup supplies the lender — same flow as the EPC View.
  async function downloadZip(lender: LenderKey) {
    if (!loan || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/admin/loan-app/${loan.id}/download-zip?lender=${lender}`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert("ZIP failed: " + (d?.error || `HTTP ${res.status}`));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      // Prefer the server's lender-stamped filename.
      const cd = res.headers.get("content-disposition") || "";
      const m = /filename="?([^"]+)"?/.exec(cd);
      const a = document.createElement("a");
      a.href = url;
      a.download = m?.[1] || `${displayId(loan)}_${String(applicantName).replace(/[^\w-]+/g, "_")}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Download failed: " + (e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return <main className="min-h-screen grid place-items-center"><p className="text-[#5a8a76]">Loading…</p></main>;
  }
  if (!loan) {
    return <main className="min-h-screen grid place-items-center"><p className="text-red-700">Loan application not found.</p></main>;
  }

  const stepsDone   = Math.min(Number(loan.current_step ?? 1), 6);
  const submitted   = !!loan.submitted_at;
  const approved    = loan.status === "approved";
  const rejected    = loan.status === "rejected";
  const underReview = loan.status === "under_review";
  const hasCoapp    = loan.bill_on_applicant_name === false;

  // Which lender decided — shown in the status band, the header pill, and
  // (for an approval) above the read-only approval table.
  const decidedLender = approved ? loan.approved_lender : rejected ? loan.rejected_lender : null;
  const decidedByLabel = decidedLender ? (LENDER_LABEL[String(decidedLender)] ?? String(decidedLender)) : null;
  const approvalDetails = (loan.approval_details ?? null) as ApprovalDetails | null;

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[#cdeadd] bg-white sticky top-0 z-30">
        <div className="w-full px-5 sm:px-8 h-14 flex items-center justify-between">
          <button
            onClick={() => router.push("/admin")}
            className="text-[14px] text-[#5a8a76] hover:text-[#0f3d2e] inline-flex items-center gap-1"
          >
            ← Back
          </button>
          <span className="font-display font-bold text-[18px] text-[#0f3d2e]">Capital Craft</span>
        </div>
      </header>

      <div className="w-full px-5 sm:px-8 py-6" style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#0f3d2e" }}>

        {/* ── HEADER CARD ─────────────────────────────────────────── */}
        <div className="rounded-[12px] border border-[#cdeadd] bg-[#f0faf5] p-5 sm:p-6 mb-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-14 h-14 rounded-[12px] bg-[#d6efe3] text-[#178a5c] grid place-items-center shrink-0 overflow-hidden" style={photoUrl ? undefined : { transform: "scale(1.3)", transformOrigin: "left center" }}>
                {photoUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={photoUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  I.user
                )}
              </div>
              <div className="min-w-0">
                <div className="text-[24px] font-semibold text-[#0f3d2e] truncate">{applicantName}</div>
                <div className="text-[14px] text-[#5a8a76] truncate mt-0.5">via {epcName}</div>
              </div>
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <Pill tint="blue" icon={I.id}>{displayId(loan)}</Pill>
              {loan.plant_use_type && <Pill tint="blue">{cap(loan.plant_use_type)}</Pill>}
              {loan.system_type && <Pill tint="blue">{SYSTEM_LABEL[loan.system_type] ?? loan.system_type}</Pill>}
              {loan.loan_amount_required != null && (
                <Pill tint="blue">{fmtRupees(loan.loan_amount_required)}</Pill>
              )}
              {decidedByLabel && (
                <Pill tint="blue" icon={I.circleCheck}>
                  {approved ? "Approved by" : "Rejected by"} {decidedByLabel}
                </Pill>
              )}
              <Pill tint="amber">{LOAN_STATUS_LABEL[loan.status] ?? loan.status ?? "Draft"}</Pill>
            </div>
          </div>
        </div>

        {/* ── LOAN STATUS BAND — admin-only, slate palette (same shape as
            the EPC View's internal-status band). "Approval"/"Rejection"
            open the lender popup; approval then routes to the details
            screen, rejection writes straight away. ─────────────────── */}
        <LoanStatusBand
          current={loan.status ?? "draft"}
          busy={statusBusy}
          decidedBy={decidedByLabel}
          onApprove={() => setApproveOpen(true)}
          onReject={() => setRejectOpen(true)}
          onReview={() => void changeStatus("under_review")}
        />
        {statusMsg && <p className="text-[12px] text-[#5a8a76] -mt-2 mb-3">{statusMsg}</p>}

        {/* Disbursement — sits directly under the status band, only once the
            loan is approved. Opens the disbursement screen. */}
        {loan.status === "approved" && (
          <div className="mb-4">
            <button
              type="button"
              onClick={() => router.push(`/admin/app/${loan.id}/disbursement` as any)}
              className="w-full sm:w-auto px-5 py-2.5 text-[14px] font-semibold rounded-[10px] border border-[#854f0b]/30 bg-[#fef8ee] text-[#854f0b] hover:bg-[#fef0d6] inline-flex items-center justify-center gap-2"
            >
              {I.money} Disbursement
            </button>
          </div>
        )}

        {/* ── PROGRESS TRACKER — prominent standalone band ─────────── */}
        <div className="rounded-[12px] border border-[#cdeadd] bg-white p-6 sm:p-8 mb-4">
          <div className="flex items-center gap-3 sm:gap-6">
            <BigProgressStep
              icon={I.check}
              done={stepsDone >= 6}
              inProgress={stepsDone > 1 && stepsDone < 6}
              label="Application complete"
              sub={`${stepsDone}/6 steps`}
            />
            <BigConnector active={stepsDone >= 6} />
            <BigProgressStep
              icon={I.send}
              done={submitted}
              label="Submitted"
              sub={submitted ? fmtDate(loan.submitted_at) : "Pending"}
            />
            <BigConnector active={submitted} />
            <BigProgressStep
              icon={I.circleCheck}
              done={approved}
              inProgress={underReview}
              label={approved ? "Approved by lender" : rejected ? "Rejected by lender" : "Decision pending"}
              sub={approved ? "Loan approved" : rejected ? "Not approved" : underReview ? "With the lender" : "Awaiting review"}
              mutedIfPending
            />
          </div>
        </div>

        {/* ── 3-COLUMN GRID ──────────────────────────────────────────── */}
        <div className="grid gap-4 lg:grid-cols-3">

          {/* COL 1 */}
          <div className="flex flex-col gap-2.5">
            <SectionCard title="Applicant identity" accent="blue" icon={I.user}>
              <KV k="Name" v={loan.aadhaar_name || loan.borrower_name} />
              <KV k="DOB" v={loan.aadhaar_dob} />
              <KV k="Gender" v={loan.aadhaar_gender} />
              <KV k="Aadhaar" v={loan.aadhaar_number_masked} />
              <KV k="PAN" v={loan.borrower_pan} />
              <KV k="Mobile" v={loan.borrower_mobile ? `+91 ${loan.borrower_mobile}` : null} />
              <KV k="Email" v={loan.borrower_email} />
              <KV k="Care of" v={loan.aadhaar_care_of} />
              <KV k="Address" v={loan.aadhaar_address} />
            </SectionCard>

            {hasCoapp && (
              <SectionCard title="Co-applicant" accent="green" icon={I.users}>
                <KV k="Name" v={loan.coapp_name} />
                <KV k="Father's name" v={loan.coapp_father_name} />
                <KV k="DOB" v={loan.coapp_dob} />
                <KV k="Relation" v={loan.coapp_relation} />
                <KV k="PAN" v={loan.coapp_pan} />
                <KV k="Mobile" v={loan.coapp_mobile ? `+91 ${loan.coapp_mobile}` : null} />
                <KV k="Email" v={loan.coapp_email} />
                {loan.coapp_aadhaar_number_masked && (
                  <>
                    <KV k="Aadhaar name" v={loan.coapp_aadhaar_name} />
                    <KV k="Aadhaar" v={loan.coapp_aadhaar_number_masked} />
                    <KV k="Address" v={loan.coapp_aadhaar_address} />
                  </>
                )}
              </SectionCard>
            )}

            <SectionCard title="Installation site" accent="blue" icon={I.building}>
              <KV k="Address" v={loan.ebill_address_line} />
              <KV k="Pincode" v={loan.install_pincode} />
              <KV k="City" v={loan.install_city} />
              <KV k="District" v={loan.install_district} />
              <KV k="State" v={loan.install_state} />
              <KV k="Bill name" v={loan.ebill_name} />
              <KV
                k="Bill on applicant"
                v={loan.bill_on_applicant_name === null || loan.bill_on_applicant_name === undefined
                  ? null
                  : loan.bill_on_applicant_name ? "Yes" : "No — co-applicant"}
              />
              {loan.rooftop_photo_gps && (
                <KV
                  k="Rooftop GPS"
                  v={`${(loan.rooftop_photo_gps as any).lat?.toFixed?.(5) ?? "?"}, ${(loan.rooftop_photo_gps as any).lng?.toFixed?.(5) ?? "?"}`}
                />
              )}
            </SectionCard>
          </div>

          {/* COL 2 */}
          <div className="flex flex-col gap-2.5">
            <SectionCard title="Documents" accent="green" icon={I.files}>
              <div className="space-y-4">
                {docGroups.map((g) => (
                  <StepBlock key={g.title} title={g.title}>
                    <DocGrid slots={toViewSlots(g)} eyeIcon={I.eye} />
                  </StepBlock>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Loan requirements" accent="green" icon={I.money}>
              <KV k="Project size" v={loan.project_size ? `${loan.project_size} ${(loan.project_size_unit ?? "kw").toUpperCase()}` : null} />
              <KV k="Project cost" v={fmtRupees(loan.total_project_cost)} />
              <KV k="Loan required" v={fmtRupees(loan.loan_amount_required)} valueClass="text-[#178a5c]" />
              <KV
                k="Down payment"
                v={loan.total_project_cost && loan.loan_amount_required
                  ? fmtRupees(Math.max(0, Number(loan.total_project_cost) - Number(loan.loan_amount_required)))
                  : null}
              />
              <KV k="System type" v={loan.system_type ? SYSTEM_LABEL[loan.system_type] ?? loan.system_type : null} />
              <KV k="Monthly bill" v={fmtRupees(loan.monthly_bill_amount)} />
              <KV k="DISCOM" v={loan.discom_name} />
              <KV k="CA number" v={loan.ca_number} />
            </SectionCard>
          </div>

          {/* COL 3 — admin only */}
          <div className="flex flex-col gap-2.5">
            {/* Approval details — filled once on the approval screen, then
                read-only here for good. */}
            {approved && approvalDetails && (
              <SectionCard title="Approval details" accent="green" icon={I.circleCheck} adminOnly>
                <ApprovalDetailsTable value={approvalDetails} readOnly />
                <p className="text-[12px] text-[#5a8a76] mt-2">
                  Recorded {fmtDate(loan.approved_at)} · read-only
                </p>
              </SectionCard>
            )}

            <SectionCard title="Loan offer" tint icon={I.money} adminOnly>
              <KV k="ROI" v={loan.roi_percent != null ? `${loan.roi_percent}%` : null} />
              <KV k="Tenure" v={loan.selected_tenure_years ? `${loan.selected_tenure_years} ${loan.selected_tenure_years === 1 ? "year" : "years"}` : null} />
              <KV k="Monthly EMI" v={fmtRupees(loan.selected_monthly_emi)} valueClass="text-[#178a5c]" />
              <KV k="Subsidy EMI" v={fmtRupees(loan.selected_subsidy_emi)} />
              <KV k="Central subsidy" v={fmtRupees(loan.central_subsidy)} />
              <KV k="State subsidy" v={fmtRupees(loan.state_subsidy)} />
            </SectionCard>

            <SectionCard title="Employment & bank" tint icon={I.bank} adminOnly>
              <KV k="Employment" v={loan.employment_type ? EMPLOYMENT_LABEL[loan.employment_type] ?? loan.employment_type : null} />
              <KV k="Profession" v={loan.profession === "Other" && loan.profession_other ? `Other — ${loan.profession_other}` : loan.profession} />
              <KV k="Organization" v={loan.organization_name} />
              <KV k="Annual income" v={fmtRupees(loan.annual_income)} />
              <KV k="Bank" v={loan.bank_name} />
              <KV k="Account" v={maskAcct(loan.bank_account_no)} />
              <KV k="IFSC" v={loan.bank_ifsc} />
              <KV k="Type" v={loan.bank_account_type} />
              <KV k="Statement source" v={loan.bank_statement_method ? METHOD_LABEL[loan.bank_statement_method] ?? loan.bank_statement_method : null} />
            </SectionCard>

            <SectionCard title="Consent & submission" tint icon={I.lock} adminOnly>
              <KV k="Consent on" v={fmtDate(loan.consent_at)} />
              <KV k="Policies" v={Array.isArray(loan.consent_policies) && loan.consent_policies.length > 0 ? loan.consent_policies.length + " accepted" : null} />
              <KV k="IP" v={loan.consent_ip} />
              <KV k="Current step" v={String(loan.current_step ?? "—")} />
              <KV k="Submitted" v={fmtDate(loan.submitted_at)} valueClass="text-[#178a5c]" />
              <KV k="Reviewed" v={fmtDate(loan.reviewed_at)} />
            </SectionCard>

            <SectionCard title="Comments" tint icon={I.lock} adminOnly>
              <CommentsSection
                applicationId={loan.id}
                epcName={applicantName}
                maxListHeight={260}
              />
            </SectionCard>
          </div>
        </div>

        {/* ── Actions strip — Activity log · Edit application · Download ZIP */}
        <div className="flex gap-3 mt-4">
          <button
            type="button"
            onClick={() => setActivityOpen(true)}
            className="flex-1 py-3.5 text-[15px] font-semibold bg-white border-2 border-[#178a5c] text-[#178a5c] rounded-[10px] hover:bg-[#f0faf5] inline-flex items-center justify-center gap-2"
          >
            {I.eye} Activity log
          </button>
          <button
            type="button"
            onClick={() => router.push(`/admin/app/${loan.id}/step-1` as any)}
            className="flex-1 py-3.5 text-[15px] font-semibold bg-[#178a5c] text-white rounded-[10px] hover:bg-[#12734c] inline-flex items-center justify-center gap-2"
          >
            {I.edit} Edit application
          </button>
          <button
            type="button"
            onClick={() => setZipPickerOpen(true)}
            disabled={downloading}
            className="flex-1 py-3.5 text-[15px] font-semibold bg-[#185fa5] text-white rounded-[10px] hover:bg-[#144d84] disabled:opacity-70 inline-flex items-center justify-center gap-2"
          >
            {I.download} {downloading ? "Preparing…" : "Download ZIP"}
          </button>
        </div>

        {/* Danger zone — Delete application (type-to-confirm). */}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => setDelOpen(true)}
            className="px-4 py-2 text-[13px] font-semibold border border-red-300 text-red-700 rounded-[8px] hover:bg-red-50 hover:border-red-500 transition-colors"
          >
            Delete application
          </button>
        </div>

      </div>

      <LenderPickerModal
        open={zipPickerOpen}
        onClose={() => setZipPickerOpen(false)}
        epcName={applicantName}
        onConfirm={(lender) => downloadZip(lender)}
      />
      <LenderDecisionModal
        open={approveOpen}
        kind="approve"
        applicantName={applicantName}
        onClose={() => setApproveOpen(false)}
        onConfirm={onApproveConfirm}
      />
      <LenderDecisionModal
        open={rejectOpen}
        kind="reject"
        applicantName={applicantName}
        onClose={() => setRejectOpen(false)}
        onConfirm={onRejectConfirm}
      />
      <LoanActivityLogModal
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        loan={loan}
        borrowerName={applicantName}
      />
      <DeleteLoanAppModal
        open={delOpen}
        onClose={() => setDelOpen(false)}
        onDeleted={() => router.replace("/admin" as any)}
        applicationId={loan.id}
        displayId={displayId(loan)}
        applicant={applicantName}
        mobile={loan.borrower_mobile ?? null}
      />
    </main>
  );
}

// ── Loan status band ────────────────────────────────────────────────
//
// Same markup/palette as the EPC View's InternalStatusBand (deliberately
// slate, not brand green), but driven by the loan's three lender outcomes.
function LoanStatusBand({
  current, busy, decidedBy, onApprove, onReject, onReview,
}: {
  current: string;
  busy: boolean;
  decidedBy: string | null;      // label of the lender that approved/rejected
  onApprove: () => void;
  onReject: () => void;
  onReview: () => void;
}) {
  const label = LOAN_STATUS_LABEL[current] ?? current;
  const decided = current === "approved" || current === "rejected";
  return (
    <div className="rounded-[12px] border border-slate-300 bg-slate-50 p-4 sm:p-5 mb-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
            Loan status <span className="normal-case font-normal text-slate-400">· admin only</span>
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[18px] font-semibold text-slate-800">{label}</span>
            {decided && decidedBy && (
              <span className={["text-[13px] font-semibold", current === "approved" ? "text-[#178a5c]" : "text-red-700"].join(" ")}>
                · {decidedBy}
              </span>
            )}
            <span className="text-[12px] text-slate-500">
              The lender outcome for this application. Every change is recorded in the activity log.
            </span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {current === "approved" ? (
            <StatusBtn kind="neutral" busy={busy} onClick={onReview}>Move back to review</StatusBtn>
          ) : current === "rejected" ? (
            <StatusBtn kind="neutral" busy={busy} onClick={onReview}>Re-open</StatusBtn>
          ) : (
            <>
              {current !== "under_review" && (
                <StatusBtn kind="neutral" busy={busy} onClick={onReview}>Mark under review</StatusBtn>
              )}
              <StatusBtn kind="approve" busy={busy} onClick={onApprove}>Approval</StatusBtn>
              <StatusBtn kind="danger" busy={busy} onClick={onReject}>Rejection</StatusBtn>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
