"use client";

// Loan Application — admin View profile.
//
// Dense, single-window operations layout (modeled on the EPC View's packed
// multi-column grid). Deliberately NOT a long column of collapsible cards.
//
// PALETTE (this page only): sky-blue #185fa5 is PRIMARY, brand-green #178a5c is
// the ACCENT — the inverse of the rest of the console. Chrome still comes from
// @/components/view/ViewKit (SectionCard/KV/DocGrid/Pill); we drive it blue via
// accent props + local components, WITHOUT editing ViewKit (so the EPC View,
// which shares the kit, is untouched).
//
// Read-only summary — "Edit" jumps to /admin/app/[id]/step-1. Disbursement
// entry stays on the dedicated /disbursement screen; this page only displays it.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import { getToken, getBusiness } from "@/lib/auth";
import { getDocumentUrl } from "@/lib/storage";
import DeleteLoanAppModal from "@/components/DeleteLoanAppModal";
import CommentsSection from "@/components/CommentsSection";
import LoanActivityLogModal from "@/components/LoanActivityLogModal";
import LenderDecisionModal from "@/components/LenderDecisionModal";
import { LENDER_LABEL, type ApprovalDetails } from "@/components/ApprovalDetailsTable";
import LenderPickerModal, { type LenderKey } from "@/components/LenderPickerModal";
import { logLoanActivity } from "@/lib/loanAudit";
import { deadlineState, DEADLINE_PILL, remainingAmount, fmtDateShort } from "@/lib/disbursement";
import {
  I, SectionCard, KV, StepBlock, DocGrid, type ViewDocSlot,
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
// Loan applications have exactly one status — the lender outcome.
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
// Approval-details cell: money → ₹ rounded, tenure → "<n> years". Numbers only
// (no spelled-out amounts anywhere on this page).
function fmtApproval(v: number | null | undefined, money: boolean, suffix?: string): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  const base = money ? fmtRupees(n) : String(n);
  return suffix ? `${base} ${suffix}` : base;
}

// ── Document grouping (missing-doc visibility) ───────────────────────
//
// Documents live two ways: user_application_docs rows (borrower_pan,
// customer_photo, borrower_photo, quotation, and ALL completion docs — viewed
// by id) and *_path columns on the row (Aadhaar, e-bill, proforma, bank
// statement, co-applicant — viewed by path). This builds the FULL lifecycle
// set grouped by stage so missing docs render greyed "Not uploaded".

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

  // Disbursement / completion documents — collected AFTER the 1st disbursement
  // (all user_application_docs rows). Shown greyed until uploaded so the
  // lifecycle set is complete.
  groups.push({
    title: "Disbursement & completion",
    slots: [
      slot("comp_invoice",  "Invoice / tax invoice",       ["completion_invoice"],        null),
      slot("comp_panel",    "Panel photo (geo-tagged)",    ["completion_panel_photo"],    null),
      slot("comp_inverter", "Inverter photo (geo-tagged)", ["completion_inverter_photo"], null),
      slot("comp_meter",    "Meter photo (geo-tagged)",    ["completion_meter_photo"],    null),
      slot("comp_report",   "Work completion report",      ["completion_report"],         null),
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

  // View a document stored as a *_path column, signed via the admin sign-doc route.
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

  // Plain status move (Mark under review / re-open). Approval + rejection go
  // through their own flows below. Every change writes status_history + an
  // activity-log row.
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

  // APPROVAL — popup picked a lender; hand off to the approval-details screen.
  function onApproveConfirm(lender: LenderKey) {
    if (!loan) return;
    router.push(`/admin/app/${loan.id}/approval?lender=${lender}` as any);
  }

  // REJECTION — record the lender + flip status immediately.
  async function onRejectConfirm(lender: LenderKey) {
    if (!loan) return;
    await changeStatus(
      "rejected",
      { rejected_lender: lender, rejected_at: new Date().toISOString(), approved_lender: null, approved_at: null },
      `Rejected by ${LENDER_LABEL[lender] ?? lender}`,
    );
  }

  // The ZIP is lender-specific — the picker popup supplies the lender.
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

  const approved    = loan.status === "approved";
  const rejected    = loan.status === "rejected";
  const underReview = loan.status === "under_review";
  const statusVal   = loan.status ?? "draft";
  const hasCoapp    = loan.bill_on_applicant_name === false;

  const decidedLender = approved ? loan.approved_lender : rejected ? loan.rejected_lender : null;
  const decidedByLabel = decidedLender ? (LENDER_LABEL[String(decidedLender)] ?? String(decidedLender)) : null;
  const approvalDetails = (loan.approval_details ?? null) as ApprovalDetails | null;

  // Disbursement — same shared 45-day countdown the tables use. Read-only.
  const dl = deadlineState(loan.first_disbursement_date);
  const firstDone = loan.first_disbursement_amount != null;
  const reviewLabel = ["approved", "rejected"].includes(String(loan.completion_docs_status))
    ? "Reviewed" : "Pending";

  // Header status/decision actions — the exact state machine (same handlers).
  const statusActions =
    statusVal === "approved" ? (
      <HAction variant="ghost" disabled={statusBusy} onClick={() => void changeStatus("under_review")}>Move back to review</HAction>
    ) : statusVal === "rejected" ? (
      <HAction variant="ghost" disabled={statusBusy} onClick={() => void changeStatus("under_review")}>Re-open</HAction>
    ) : (
      <>
        {statusVal !== "under_review" && (
          <HAction variant="ghost" disabled={statusBusy} onClick={() => void changeStatus("under_review")}>Mark under review</HAction>
        )}
        <HAction variant="primary" icon={I.check} disabled={statusBusy} onClick={() => setApproveOpen(true)}>Approval</HAction>
        <HAction variant="danger" disabled={statusBusy} onClick={() => setRejectOpen(true)}>Rejection</HAction>
      </>
    );

  return (
    <main className="min-h-screen bg-[#f7fafd]">
      {/* ── STICKY HEADER — identity (left) + every action (right) ─────── */}
      <header className="border-b border-[#d3e9f7] bg-white/95 backdrop-blur sticky top-0 z-30">
        <div className="w-full px-5 sm:px-8 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => router.push("/admin")}
              className="text-[13px] text-[#5f7d95] hover:text-[#0f2f4d] inline-flex items-center gap-1 shrink-0"
            >
              ← Back
            </button>
            <div className="w-px h-9 bg-[#e2eef7] shrink-0" />
            <div
              className="w-11 h-11 rounded-[10px] bg-[#dceffb] text-[#185fa5] grid place-items-center shrink-0 overflow-hidden"
              style={photoUrl ? undefined : { transform: "scale(1.2)", transformOrigin: "center" }}
            >
              {photoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={photoUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                I.user
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[18px] font-semibold text-[#0f2f4d] truncate">{applicantName}</span>
                <StatusBadge status={loan.status} />
              </div>
              <div className="text-[12px] text-[#5f7d95] truncate flex items-center gap-1.5 mt-0.5">
                <span className="font-semibold text-[#185fa5]">{displayId(loan)}</span>
                <span className="text-[#c2d9ea]">·</span>
                <span className="truncate">via {epcName}</span>
                {loan.created_at && (
                  <>
                    <span className="text-[#c2d9ea]">·</span>
                    <span className="whitespace-nowrap">Created {fmtDateShort(loan.created_at)}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {statusActions}
            {approved && (
              <HAction variant="amber" icon={I.money} onClick={() => router.push(`/admin/app/${loan.id}/disbursement` as any)}>
                Disbursement
              </HAction>
            )}
            <HAction variant="outline" icon={I.edit} onClick={() => router.push(`/admin/app/${loan.id}/step-1` as any)}>
              Edit
            </HAction>
            <HAction variant="primary" icon={I.download} disabled={downloading} onClick={() => setZipPickerOpen(true)}>
              {downloading ? "Preparing…" : "Download ZIP"}
            </HAction>
            <HAction variant="ghost" icon={I.eye} onClick={() => setActivityOpen(true)}>
              Activity log
            </HAction>
            <HAction variant="dangerOutline" onClick={() => setDelOpen(true)}>
              Delete
            </HAction>
          </div>
        </div>
        {statusMsg && <div className="px-5 sm:px-8 pb-2 text-[12px] text-[#5f7d95]">{statusMsg}</div>}
      </header>

      {/* ── DENSE GRID — one window, no long scroll ─────────────────────── */}
      <div className="w-full px-5 sm:px-8 py-4" style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#0f2f4d" }}>
        <div className="grid gap-3 lg:grid-cols-3 items-start">

          {/* COL 1 — identity */}
          <div className="flex flex-col gap-3">
            <SectionCard title="Applicant identity" accent="blue" icon={I.user}>
              <KV k="Name" v={loan.aadhaar_name || loan.borrower_name} />
              <KV k="Father's name" v={loan.borrower_father_name} />
              <KV k="Gender" v={loan.aadhaar_gender} />
              <KV k="Date of birth" v={loan.aadhaar_dob} />
              <KV k="PAN" v={loan.borrower_pan} />
              <KV k="Aadhaar" v={loan.aadhaar_number_masked} />
              <KV k="Email" v={loan.borrower_email} valueClass="text-[#185fa5]" />
              <KV k="Phone no" v={loan.borrower_mobile ? `+91 ${loan.borrower_mobile}` : null} />
              <KV k="Address" v={loan.aadhaar_address} />

              <div className="mt-3">
                <StepBlock title="Installation identity">
                  <KV k="Name on bill" v={loan.ebill_name} />
                  <KV
                    k="Bill on applicant"
                    v={loan.bill_on_applicant_name === null || loan.bill_on_applicant_name === undefined
                      ? null
                      : loan.bill_on_applicant_name ? "Yes" : "No — co-applicant"}
                  />
                </StepBlock>
              </div>
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

            <SectionCard title="Employment & bank" accent="blue" icon={I.bank} adminOnly>
              <StepBlock title="Employment">
                <KV k="Employment" v={loan.employment_type ? EMPLOYMENT_LABEL[loan.employment_type] ?? loan.employment_type : null} />
                <KV k="Organization" v={loan.organization_name} />
                <KV k="Profession" v={loan.profession === "Other" && loan.profession_other ? `Other — ${loan.profession_other}` : loan.profession} />
                <KV k="Annual income" v={fmtRupees(loan.annual_income)} />
              </StepBlock>
              <div className="mt-3">
                <StepBlock title="Bank">
                  <KV k="Bank name" v={loan.bank_name} />
                  <KV k="Account no" v={maskAcct(loan.bank_account_no)} />
                  <KV k="IFSC code" v={loan.bank_ifsc} />
                  <KV k="Type" v={loan.bank_account_type} />
                </StepBlock>
              </div>
            </SectionCard>
          </div>

          {/* COL 2 — site & loan requirements */}
          <div className="flex flex-col gap-3">
            <SectionCard title="Installation site details" accent="blue" icon={I.building}>
              <KV k="Address" v={loan.ebill_address_line} />
              <KV k="Pincode" v={loan.install_pincode} />
              <KV k="City" v={loan.install_city} />
              <KV k="District" v={loan.install_district} />
              <KV k="State" v={loan.install_state} />
              {loan.rooftop_photo_gps && (
                <KV
                  k="Rooftop GPS"
                  v={`${(loan.rooftop_photo_gps as any).lat?.toFixed?.(5) ?? "?"}, ${(loan.rooftop_photo_gps as any).lng?.toFixed?.(5) ?? "?"}`}
                />
              )}
              <div className="mt-3">
                <StepBlock title="Loan requirements">
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
                </StepBlock>
              </div>
            </SectionCard>
          </div>

          {/* COL 3 — decision, sanction, documents, comments */}
          <div className="flex flex-col gap-3">
            {approved && approvalDetails && (
              <SectionCard title="Approval details" accent="blue" icon={I.circleCheck} adminOnly>
                <div className="text-[14px] mb-2">
                  <span className="text-[#5f7d95] font-medium">Approved By: </span>
                  <span className="text-[#185fa5] font-bold">
                    {approvalDetails.approved_by
                      ? (LENDER_LABEL[String(approvalDetails.approved_by)] ?? String(approvalDetails.approved_by))
                      : (decidedByLabel ?? "—")}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[14px] border-collapse">
                    <thead>
                      <tr className="border-b border-[#e2eef7]">
                        <th className="py-1.5 pr-4 text-left font-medium text-[#5f7d95]"></th>
                        <th className="py-1.5 px-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#8aa6bd]">Applied</th>
                        <th className="py-1.5 px-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#185fa5]">Approved</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: "Loan Amount", applied: approvalDetails.applied_loan_amount, approved: approvalDetails.approved_loan_amount, money: true, suffix: undefined as string | undefined },
                        { label: "Tenure",      applied: approvalDetails.applied_tenure_years, approved: approvalDetails.approved_tenure_years, money: false, suffix: "years" },
                        { label: "EMI",         applied: approvalDetails.tentative_emi,         approved: approvalDetails.approved_emi,         money: true, suffix: undefined },
                      ].map((r) => (
                        <tr key={r.label} className="border-b border-[#e2eef7] last:border-0">
                          <td className="py-2 pr-4 text-[#5f7d95] font-medium">{r.label}</td>
                          <td className="py-2 px-3 text-right font-semibold text-[#0f2f4d]">{fmtApproval(r.applied, r.money, r.suffix)}</td>
                          <td className="py-2 px-3 text-right font-semibold text-[#185fa5]">{fmtApproval(r.approved, r.money, r.suffix)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[12px] text-[#5f7d95] mt-2">Recorded {fmtDate(loan.approved_at)} · read-only</p>
              </SectionCard>
            )}

            {approved && (
              <SectionCard title="Sanction details" accent="blue" icon={I.money} adminOnly>
                <StepBlock title="1st Disbursement">
                  <KV k="Amount" v={fmtRupees(loan.first_disbursement_amount)} valueClass="text-[#178a5c]" />
                  <KV k="Date" v={fmtDateShort(loan.first_disbursement_date)} />
                  <div className="flex justify-between items-center text-[14px] py-[5px] gap-3">
                    <span className="text-[#5f7d95] shrink-0">Countdown to 2nd</span>
                    <span className={["inline-flex px-2 py-0.5 rounded-[6px] text-[12px] font-semibold", DEADLINE_PILL[dl.tone]].join(" ")}>
                      {firstDone ? dl.label : "—"}
                    </span>
                  </div>
                  <KV k="Remaining (pending)" v={fmtRupees(remainingAmount(loan.sanctioned_amount, loan.first_disbursement_amount))} />
                </StepBlock>
                <div className="mt-3">
                  <StepBlock title="2nd Disbursement">
                    <KV k="Amount" v={fmtRupees(loan.second_disbursement_amount)} valueClass="text-[#178a5c]" />
                    <KV k="Date" v={fmtDateShort(loan.second_disbursement_date)} />
                    <div className="flex justify-between items-center text-[14px] py-[5px] gap-3">
                      <span className="text-[#5f7d95] shrink-0">Documents review</span>
                      <span className={["inline-flex px-2 py-0.5 rounded-[6px] text-[12px] font-semibold",
                        reviewLabel === "Reviewed" ? "bg-[#e6f6ee] text-[#178a5c]" : "bg-[#fef0d6] text-[#854f0b]"].join(" ")}>
                        {reviewLabel}
                      </span>
                    </div>
                  </StepBlock>
                </div>
              </SectionCard>
            )}

            <SectionCard title="Documents" accent="blue" icon={I.files}>
              <div className="space-y-3">
                {docGroups.map((g) => (
                  <StepBlock key={g.title} title={g.title}>
                    <DocGrid slots={toViewSlots(g)} eyeIcon={I.eye} />
                  </StepBlock>
                ))}
              </div>
            </SectionCard>

            {/* Comments — inline (existing behavior). Sits under Documents. */}
            <SectionCard title="Comments" accent="blue" icon={I.lock} adminOnly>
              <CommentsSection
                applicationId={loan.id}
                epcName={applicantName}
                maxListHeight={200}
              />
            </SectionCard>
          </div>
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

// ── Header action button (blue-primary theme, local to this page) ────
function HAction({
  children, onClick, variant = "ghost", icon, disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: "primary" | "amber" | "outline" | "ghost" | "danger" | "dangerOutline";
  icon?: ReactNode;
  disabled?: boolean;
}) {
  const cls =
    variant === "primary"       ? "bg-[#185fa5] text-white border-[#185fa5] hover:bg-[#144d84]" :
    variant === "amber"         ? "bg-[#fef8ee] text-[#854f0b] border-[#854f0b]/30 hover:bg-[#fef0d6]" :
    variant === "outline"       ? "bg-white text-[#185fa5] border-[#9dc7e8] hover:bg-[#eff6fc]" :
    variant === "danger"        ? "bg-white text-red-700 border-red-300 hover:bg-red-50" :
    variant === "dangerOutline" ? "bg-white text-red-700 border-red-300 hover:bg-red-50 hover:border-red-500" :
                                  "bg-white text-[#0f2f4d] border-[#d3e9f7] hover:bg-[#eff6fc]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={["text-[13px] font-semibold px-3 py-1.5 rounded-[8px] border transition-colors disabled:opacity-60 inline-flex items-center gap-1.5", cls].join(" ")}
    >
      {icon && <span className="shrink-0" style={{ display: "inline-flex" }}>{icon}</span>}
      {children}
    </button>
  );
}

// ── Status badge — the lender outcome, coloured. ─────────────────────
function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = status ?? "draft";
  const label = LOAN_STATUS_LABEL[s] ?? s;
  const cls =
    s === "approved" ? "bg-[#e6f6ee] text-[#178a5c] border-[#cdeadd]" :
    s === "rejected" ? "bg-red-50 text-red-700 border-red-200" :
    s === "under_review" ? "bg-[#dceffb] text-[#185fa5] border-[#bfe0f5]" :
                       "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span className={["shrink-0 inline-flex px-2 py-0.5 rounded-full border text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap", cls].join(" ")}>
      {label}
    </span>
  );
}
