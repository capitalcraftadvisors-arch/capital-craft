"use client";

// Loan Application — admin View profile.
//
// Dense, single-window operations layout on the SAME green design language as
// the EPC View (green #178a5c primary, sky-blue #185fa5 accents, white).
// Chrome comes from @/components/view/ViewKit (SectionCard/KV/DocGrid/Pill/
// BigProgressStep), so the two dashboards stay visually in step.
//
// Read-only summary — "Edit" jumps to /admin/app/[id]/step-1. Disbursement
// entry stays on the dedicated /disbursement screen; this page only displays it.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import { getToken, getBusiness } from "@/lib/auth";
import { getDocumentUrl, deleteDocument } from "@/lib/storage";
import DeleteLoanAppModal from "@/components/DeleteLoanAppModal";
import CommentsSection from "@/components/CommentsSection";
import LoanActivityLogModal from "@/components/LoanActivityLogModal";
import LenderDecisionModal from "@/components/LenderDecisionModal";
import { LENDER_LABEL, type ApprovalDetails } from "@/components/ApprovalDetailsTable";
import LenderPickerModal, { type LenderKey } from "@/components/LenderPickerModal";
import ProfileTabBar, { TabButton, DownloadMenu, KebabMenu } from "@/components/ProfileTabBar";
import { logLoanActivity } from "@/lib/loanAudit";
import { deadlineState, DEADLINE_PILL, remainingAmount, fmtDateShort } from "@/lib/disbursement";
import {
  I, SectionCard, KV, StepBlock, DocGrid, BigProgressStep, BigConnector, type ViewDocSlot,
} from "@/components/view/ViewKit";

type Loan = Record<string, any>;
type Doc  = { id: string; category: string; storage_path: string; file_name: string | null; mime_type: string | null };

// Slot key → epc_applications *_path column, for admin doc-removal (trash) on
// path-backed slots. Keys NOT listed here are doc-row backed (deleted by id).
const PATH_COLUMN: Record<string, string> = {
  applicant_photo:     "customer_photo_path",
  aadhaar_front:       "aadhaar_front_path",
  aadhaar_back:        "aadhaar_back_path",
  quotation:           "proforma_invoice_path",
  ebill:               "ebill_path",
  rooftop:             "rooftop_photo_path",
  coapp_pan:           "coapp_pan_path",
  coapp_aadhaar_front: "coapp_aadhaar_front_path",
  coapp_aadhaar_back:  "coapp_aadhaar_back_path",
  bank_statement:      "bank_statement_path",
};

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
  docs_sent:    "Docs Sent",
  on_hold:      "Hold",
  aborted:      "Aborted",
  approved:     "Approved by lender",
  rfd:          "Ready for Disbursement",
  rejected:     "Rejected by lender",
};
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

// Local trash glyph — kept here (not in ViewKit) so the shared kit and the
// EPC View that imports it stay untouched.
const PAUSE = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 5v14M14 5v14" />
  </svg>
);

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
// Approval-details cell: money → ₹ rounded, tenure → "<n> years". Numbers only.
function fmtApproval(v: number | null | undefined, money: boolean, suffix?: string): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  const base = money ? fmtRupees(n) : String(n);
  return suffix ? `${base} ${suffix}` : base;
}

// ── Document grouping (missing-doc visibility) ───────────────────────

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
      slot("applicant_photo", "Applicant photo",    ["customer_photo"], loan.customer_photo_path ?? loan.aadhaar_face_path),
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

  // Bank statements dual-read from BOTH stores: the legacy single column
  // (the OCR'd primary uploaded via Step-4's BankDocSlot) AND every
  // user_application_docs row in category "bank_statement" (the extra
  // statements added by the Step-4 multi-file uploader). Show them all —
  // taking only the first row (as slot() does) would hide the rest.
  const bankRows = docs.filter((d) => d.category === "bank_statement" && !usedRowIds.has(d.id));
  bankRows.forEach((d) => usedRowIds.add(d.id));
  const bankSlots: LoanSlot[] = [];
  if (loan.bank_statement_path) {
    bankSlots.push({ key: "bank_statement", label: "Bank statement", docId: null, path: loan.bank_statement_path });
  }
  bankRows.forEach((d) => {
    bankSlots.push({ key: `bank_statement_${d.id}`, label: "Bank statement", docId: d.id, path: null });
  });
  if (bankSlots.length === 0) {
    bankSlots.push({ key: "bank_statement", label: "Bank statement", docId: null, path: null });
  }
  if (bankSlots.length > 1) {
    bankSlots.forEach((s, i) => { s.label = `Bank statement ${i + 1}`; });
  }
  groups.push({ title: "Financial (Step 4)", slots: bankSlots });

  groups.push({
    title: "Step 5 — Sanction Letter",
    slots: [
      slot("sanction_letter", "Sanction letter", ["sanction_letter"], null),
    ],
  });

  groups.push({
    title: "1st Tranche Docs",
    slots: [
      slot("feasibility_report",  "Feasibility Approval Report", ["feasibility_report"],  null),
      slot("mmr_advance_receipt", "MMR / Advance Receipt",       ["mmr_advance_receipt"], null),
    ],
  });

  groups.push({
    title: "2nd Tranche Docs",
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
  const [trancheBusy, setTrancheBusy] = useState<null | "1" | "2">(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [zipPickerOpen, setZipPickerOpen] = useState(false);
  const [abortOpen, setAbortOpen] = useState(false);
  const [abortReason, setAbortReason] = useState("");

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
      } else if (la?.aadhaar_face_path) {
        // No dedicated applicant photo — fall back to the face cropped from the
        // borrower's Aadhaar (captured at OCR time) as the applicant photo.
        const url = await signPath(la.aadhaar_face_path as string);
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

  // Sign a *_path column (whitelisted server-side) and RETURN the URL.
  async function signPath(path: string): Promise<string | null> {
    try {
      const res = await fetch(`/api/admin/loan-app/${params.id}/sign-doc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ path }),
      });
      const data = await res.json().catch(() => ({}));
      return data?.ok && data.url ? (data.url as string) : null;
    } catch {
      return null;
    }
  }

  async function openPath(path: string) {
    const url = await signPath(path);
    if (url) window.open(url, "_blank", "noopener");
  }

  // Remove a doc-row-backed document (user_application_docs) — immediate.
  async function removeDocRow(docId: string) {
    const ok = await deleteDocument(docId);
    if (!ok) { alert("Couldn't remove the document."); return; }
    setDocs((arr) => arr.filter((d) => d.id !== docId));
  }

  // Remove a *_path-backed document via the admin-only route (nulls the column
  // + deletes exactly that GCS object + writes activity log) — immediate.
  async function removePathDoc(column: string) {
    try {
      const res = await fetch("/api/admin/delete-doc-path", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ table: "epc_applications", id: params.id, column }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) { alert("Couldn't remove: " + (data?.error || res.status)); return; }
      setLoan((prev: Loan | null) => (prev ? { ...prev, [column]: null } : prev));
    } catch (e) {
      alert("Couldn't remove: " + (e as Error).message);
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
      onDelete: s.docId
        ? () => void removeDocRow(s.docId!)
        : s.path && PATH_COLUMN[s.key]
        ? () => void removePathDoc(PATH_COLUMN[s.key])
        : undefined,
    }));
  }

  async function changeStatus(next: string, extra: Record<string, unknown> = {}, note = "") {
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

  function onApproveConfirm(lender: LenderKey) {
    if (!loan) return;
    router.push(`/admin/app/${loan.id}/approval?lender=${lender}` as any);
  }

  async function onRejectConfirm(lender: LenderKey, reason?: string, creditScore?: number | null) {
    if (!loan) return;
    const why = (reason ?? "").trim();
    await changeStatus(
      "rejected",
      {
        rejected_lender: lender, rejected_at: new Date().toISOString(),
        approved_lender: null, approved_at: null, rejection_reason: why || null,
        ...(creditScore !== undefined ? { credit_score: creditScore } : {}),
      },
      `Rejected by ${LENDER_LABEL[lender] ?? lender}${why ? ` — ${why}` : ""}`,
    );
  }

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

  // Per-tranche ZIP (docs for that tranche only + a small summary sheet).
  async function downloadTranche(tranche: "1" | "2") {
    if (!loan || trancheBusy) return;
    setTrancheBusy(tranche);
    try {
      const res = await fetch(`/api/admin/loan-app/${loan.id}/tranche-zip?tranche=${tranche}`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert("Download failed: " + (d?.error || `HTTP ${res.status}`));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const cd = res.headers.get("content-disposition") || "";
      const m = /filename="?([^"]+)"?/.exec(cd);
      const a = document.createElement("a");
      a.href = url;
      a.download = m?.[1] || `${displayId(loan)}_Tranche${tranche}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Download failed: " + (e as Error).message);
    } finally {
      setTrancheBusy(null);
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
  const rfd         = loan.status === "rfd";
  const statusVal   = loan.status ?? "draft";
  const hasCoapp    = loan.bill_on_applicant_name === false;
  const aborted     = loan.aborted_at != null;
  // Approval-and-beyond (includes RFD). "RFD reached" = the 'rfd' status OR a
  // stamped rfd_at (backfilled/legacy rows).
  const approvedPlus   = ["approved", "rfd", "sent_to_nbfc", "disbursed"].includes(statusVal);
  const rfdReached     = rfd || loan.rfd_at != null;
  const approvalFilled = loan.approval_details_filled === true;

  const decidedLender = approvedPlus ? loan.approved_lender : rejected ? loan.rejected_lender : null;
  const decidedByLabel = decidedLender ? (LENDER_LABEL[String(decidedLender)] ?? String(decidedLender)) : null;
  const approvalDetails = (loan.approval_details ?? null) as ApprovalDetails | null;

  const dl = deadlineState(loan.first_disbursement_date);
  const firstDone  = loan.first_disbursement_amount != null;
  const secondDone = loan.second_disbursement_amount != null;
  const reviewLabel = ["approved", "rejected"].includes(String(loan.completion_docs_status))
    ? "Reviewed" : "Pending";

  const docsSent = loan.status === "docs_sent";
  const onHold   = loan.status === "on_hold";

  // Node 1 "Submitted" completes only when every step 1–4 application doc is
  // present (tranche/completion docs excluded) — mirrors the dashboard's
  // loanDocsPending. The Docs Sent button stays gated on this.
  const hasCat = (c: string) => docs.some((d) => d.category === c);
  // Required docs to enable Doc Sent (Steps 1–4). Rooftop photo (Step 3) is
  // intentionally NOT required — optional in backend logic only, with no
  // "optional" label in the UI. Sanction Letter / Tranche 1 / Tranche 2 are
  // NOT required here (they only come after approval).
  const appDocsComplete =
    hasCat("borrower_pan") &&
    !!loan.aadhaar_front_path && !!loan.aadhaar_back_path &&
    (hasCat("quotation")        || !!loan.proforma_invoice_path) &&
    (hasCat("electricity_bill") || !!loan.ebill_path) &&
    (hasCat("customer_photo")   || !!loan.customer_photo_path) &&
    (hasCat("bank_statement")   || !!loan.bank_statement_path) &&
    (!hasCoapp || (!!loan.coapp_pan_path && !!loan.coapp_aadhaar_front_path && !!loan.coapp_aadhaar_back_path));

  // Tracker reads an "effective" status so a held case still shows where it
  // was parked (Resume returns it there).
  const effStatus = onHold ? (loan.status_before_hold ?? "under_review") : statusVal;
  const tDocsSent = ["docs_sent", "approved", "rfd", "rejected", "sent_to_nbfc", "disbursed"].includes(effStatus);
  const tApproved = ["approved", "rfd", "sent_to_nbfc", "disbursed"].includes(effStatus);
  const tRejected = effStatus === "rejected";
  const tDecided  = tApproved || tRejected;

  // Tranche ZIPs are offered in the Download menu only when that tranche's
  // documents actually exist (no empty-tranche ZIP).
  const tranche1Exists = docs.some((d) => ["feasibility_report", "mmr_advance_receipt"].includes(d.category));
  const tranche2Exists = docs.some((d) =>
    ["completion_invoice", "completion_panel_photo", "completion_inverter_photo", "completion_meter_photo", "completion_report"].includes(d.category),
  );

  // RFD gate — Ready for Disbursement becomes clickable only once approval
  // details are filled AND both Tranche-1 docs (Feasibility + MMR/Advance
  // receipt) are present. Clicking writes status='rfd' + rfd_at + activity log.
  const tranche1Complete = hasCat("feasibility_report") && hasCat("mmr_advance_receipt");
  const canRfd = approved && approvalFilled && tranche1Complete && !rfdReached;
  const markRfd = () =>
    void changeStatus("rfd", { rfd_at: new Date().toISOString() }, "Ready for disbursement");

  // Change review — undo the current lender decision (and any abort) and move
  // the application back to Docs Sent so the admin can Approve/Reject again.
  // Fixes cases mistakenly marked Approved/Rejected by lender.
  const changeReview = () => {
    if (!window.confirm(
      "Change the review?\n\nThis undoes the current lender decision (and any abort) and moves the application back to Docs Sent, where you can Approve or Reject again.",
    )) return;
    void changeStatus("docs_sent", {
      approved_lender: null, approved_at: null,
      rejected_lender: null, rejected_at: null,
      rfd_at: null, approval_details_filled: false,
      aborted_at: null, abort_reason: null,
    }, "Review changed — reverted to Docs Sent");
  };

  // Three-dot overflow menu (replaces the bare trash button). "Change review"
  // only appears once there's a decision/abort to undo.
  const canChangeReview = approvedPlus || rejected || aborted;
  const kebabItems = [
    ...(canChangeReview ? [{
      label: "Change review",
      icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>),
      onClick: changeReview,
    }] : []),
    {
      label: "Delete",
      icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>),
      onClick: () => setDelOpen(true),
      danger: true,
    },
  ];

  const markDocsSent = () =>
    void changeStatus("docs_sent", { docs_sent_at: new Date().toISOString() }, "Docs sent to lender");
  const holdCase = () =>
    void changeStatus("on_hold", { hold_at: new Date().toISOString(), status_before_hold: loan.status }, "Put on hold");
  const resumeHold = () => {
    const prior = (loan.status_before_hold as string) || "under_review";
    void changeStatus(prior, { hold_at: null, status_before_hold: null }, `Resumed to ${LOAN_STATUS_LABEL[prior] ?? prior}`);
  };
  // Abort — a recorded soft-cancel (not a delete, not a status change). Keeps
  // the underlying status; the aborted_at flag makes it read as "Aborted".
  async function doAbort(reason: string) {
    if (!loan || statusBusy) return;
    setStatusBusy(true);
    setStatusMsg(null);
    const me = getBusiness();
    const by = me?.contact_name || "admin";
    const now = new Date().toISOString();
    const patch = { aborted_at: now, abort_reason: reason, reviewed_by: by, reviewed_at: now };
    const { error } = await supabase().from("epc_applications").update(patch).eq("id", loan.id);
    if (error) { setStatusMsg("Couldn't abort — " + error.message); setStatusBusy(false); return; }
    setLoan({ ...loan, ...patch });
    setStatusMsg("Application aborted.");
    await logLoanActivity(loan.id, "status_change", { detail: `Aborted — ${reason}` });
    setStatusBusy(false);
  }

  // Header status/decision actions — Submitted → Docs Sent → Approve/Reject,
  // plus Hold/Resume. Approve/Reject handlers unchanged; the back-transitions
  // retarget to Docs Sent, and Docs Sent → Under Review is the single undo.
  const statusActions =
    onHold ? (
      <>
        <span className="text-[13px] font-semibold px-3 py-2 rounded-[8px] border bg-[#fff2cc] text-[#8a6500] border-[#f3d9a4] inline-flex items-center gap-1.5">
          {PAUSE} On hold
        </span>
        <HAction variant="primary" disabled={statusBusy} onClick={resumeHold}>Resume</HAction>
      </>
    ) : approved ? (
      // No "Approved" pill here — the tracker already shows the Approved stage.
      // The bar carries the next actions: Mark RFD + Disbursement (+ Abort).
      <>
        <HAction
          variant="primary"
          disabled={statusBusy || !canRfd}
          title={canRfd ? undefined : (!approvalFilled ? "Fill approval details first" : !tranche1Complete ? "Upload both Tranche-1 documents first" : undefined)}
          onClick={markRfd}
        >
          Mark RFD
        </HAction>
        <HAction variant="reject" disabled={statusBusy} onClick={() => setAbortOpen(true)}>Abort</HAction>
      </>
    ) : rfd ? (
      // No "RFD" pill either — the tracker shows the RFD stage; the bar just
      // carries Disbursement (rendered next to statusActions) + Abort.
      <>
        <HAction variant="reject" disabled={statusBusy} onClick={() => setAbortOpen(true)}>Abort</HAction>
      </>
    ) : rejected ? (
      <HAction variant="ghost" disabled={statusBusy} onClick={() => void changeStatus("docs_sent")}>Re-open to Docs Sent</HAction>
    ) : (
      <>
        {docsSent ? (
          <>
            <span className="text-[13px] font-semibold px-3 py-2 rounded-[8px] border bg-[#dceffb] text-[#185fa5] border-[#bfe0f5] inline-flex items-center gap-1.5">
              {I.send} Docs sent
            </span>
            <HAction variant="ghost" disabled={statusBusy} onClick={() => void changeStatus("under_review")}>Undo → Under Review</HAction>
          </>
        ) : (
          <HAction
            variant="primary"
            icon={I.send}
            disabled={statusBusy || !appDocsComplete}
            title={appDocsComplete ? undefined : "Upload all application documents first"}
            onClick={markDocsSent}
          >
            Docs Sent
          </HAction>
        )}
        <HAction variant="approve" icon={I.check} disabled={statusBusy || !docsSent} title={docsSent ? undefined : "Mark Docs Sent first"} onClick={() => setApproveOpen(true)}>Approve</HAction>
        <HAction variant="reject" disabled={statusBusy || !docsSent} title={docsSent ? undefined : "Mark Docs Sent first"} onClick={() => setRejectOpen(true)}>Rejection</HAction>
        {(underReview || docsSent) && (
          <HAction variant="amber" icon={PAUSE} disabled={statusBusy} onClick={holdCase}>Hold</HAction>
        )}
      </>
    );

  return (
    <main className="min-h-screen bg-white">
      {/* ── STICKY HEADER — name / loan-ID · created / EPC, + actions ──── */}
      <header className="border-b border-[#cdeadd] bg-white/95 backdrop-blur sticky top-0 z-30">
        <div className="w-full px-5 sm:px-8 py-4 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4 min-w-0">
            <button
              onClick={() => router.push("/admin")}
              className="text-[13px] text-[#5a8a76] hover:text-[#0f3d2e] inline-flex items-center gap-1 shrink-0 mt-1"
            >
              ← Back to console
            </button>
            <div className="w-px h-14 bg-[#e2efe9] shrink-0" />
            <div
              className="w-16 h-16 rounded-[12px] bg-[#d6efe3] text-[#178a5c] grid place-items-center shrink-0 overflow-hidden"
              style={photoUrl ? undefined : { transform: "scale(1.25)", transformOrigin: "center" }}
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
                <span className="text-[22px] font-semibold text-[#0f3d2e] truncate">{applicantName}</span>
                <StatusBadge status={aborted ? "aborted" : loan.status} lender={decidedByLabel} />
              </div>
              {/* Loan ID, with "Created …" where "via <EPC>" used to sit. */}
              <div className="text-[13px] flex items-center gap-2 mt-1 min-w-0">
                <span className="font-semibold text-[#185fa5]">{displayId(loan)}</span>
                {loan.created_at && (
                  <>
                    <span className="text-[#c7ddd2]">·</span>
                    <span className="text-[#5a8a76] whitespace-nowrap">Created {fmtDateShort(loan.created_at)}</span>
                  </>
                )}
              </div>
              {/* EPC partner — directly under the loan ID. */}
              <div className="text-[13px] text-[#5a8a76] truncate mt-0.5">{epcName}</div>
            </div>
          </div>

        </div>
        {statusMsg && <div className="px-5 sm:px-8 pb-2 text-[12px] text-[#5a8a76]">{statusMsg}</div>}
        {aborted && loan.abort_reason && (
          <div className="px-5 sm:px-8 pb-2 text-[12px] font-medium text-red-700">Aborted — {loan.abort_reason}</div>
        )}
        {rejected && loan.rejection_reason && (
          <div className="px-5 sm:px-8 pb-2 text-[12px] font-medium text-red-700">Rejection reason: {loan.rejection_reason}</div>
        )}
      </header>

      <div className="w-full px-5 sm:px-8 py-4" style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#0f3d2e" }}>

        {/* ── TAB / ACTION ROW — tabs (left) + stage actions (right) ────── */}
        <ProfileTabBar
          left={
            <>
              <TabButton label="Profile" icon={I.user} active />
              {/* After approval, Edit becomes a dropdown of the three editable
                  sections (each editable once, then locked). Before approval it's
                  the normal jump to the step flow. */}
              {approvedPlus && !aborted ? (
                <DownloadMenu
                  label="Edit"
                  icon={I.edit}
                  items={[
                    {
                      // Full profile/step edit — available after approval too.
                      label: "Edit",
                      onClick: () => router.push(`/admin/app/${loan.id}/step-1` as any),
                    },
                    {
                      // Approval details INCLUDE the sanction letter. Fully editable,
                      // repeatedly — no edit-once lock.
                      label: "Approval details",
                      onClick: () => router.push(`/admin/app/${loan.id}/approval?lender=${loan.approved_lender ?? ""}&edit=approval` as any),
                    },
                    {
                      // "Sanction details" = the disbursement values (matches the
                      // profile's Sanction-details card). Fully editable, repeatedly.
                      label: "Sanction details",
                      onClick: () => router.push(`/admin/app/${loan.id}/disbursement` as any),
                    },
                  ]}
                />
              ) : (
                <TabButton
                  label="Edit"
                  icon={I.edit}
                  disabled={aborted}
                  title={aborted ? "Aborted — cannot edit" : undefined}
                  onClick={() => router.push(`/admin/app/${loan.id}/step-1` as any)}
                />
              )}
              <TabButton label="Activity Log" icon={I.eye} onClick={() => setActivityOpen(true)} />
              <DownloadMenu
                icon={I.download}
                disabled={downloading}
                busyLabel={downloading ? "Preparing…" : null}
                items={[
                  { label: "Download ZIP", onClick: () => setZipPickerOpen(true) },
                  ...(tranche1Exists ? [{ label: "Download Tranche 1", onClick: () => void downloadTranche("1"), disabled: trancheBusy === "1" }] : []),
                  ...(tranche2Exists ? [{ label: "Download Tranche 2", onClick: () => void downloadTranche("2"), disabled: trancheBusy === "2" }] : []),
                ]}
              />
            </>
          }
          right={
            aborted ? (
              <KebabMenu items={kebabItems} />
            ) : (
              <>
                {statusActions}
                {/* Disbursement page opens once approval details are filled — it
                    hosts the Tranche-1 upload; the 1st-amount field there stays
                    locked until RFD is marked. */}
                {approvedPlus && approvalFilled && (
                  <HAction variant="amber" icon={I.money} onClick={() => router.push(`/admin/app/${loan.id}/disbursement` as any)}>
                    Disbursement
                  </HAction>
                )}
                {/* Three-dot menu — Change review (undo lender decision) + Delete
                    (type-DELETE modal). Available at every stage. */}
                <KebabMenu items={kebabItems} />
              </>
            )
          }
        />

        {/* ── PROGRESS TRACKER — hidden once all stages are complete (2nd disbursement) ── */}
        {!secondDone && (
        <div className="rounded-[12px] border border-[#cdeadd] bg-white p-5 sm:p-6 mb-4">
          <div className="flex items-center gap-2 sm:gap-4">
            <BigProgressStep
              icon={I.send}
              done={appDocsComplete}
              inProgress={!appDocsComplete}
              label="Submitted"
              sub={appDocsComplete ? (loan.submitted_at ? fmtDateShort(loan.submitted_at) : "Complete") : "Awaiting documents"}
              mutedIfPending
            />
            <BigConnector active={appDocsComplete} />
            <BigProgressStep
              icon={I.files}
              done={tDocsSent}
              inProgress={!tDocsSent && appDocsComplete && !onHold}
              label="Docs Sent"
              sub={tDocsSent ? "Sent to lender" : onHold ? "On hold" : appDocsComplete ? "Ready to send" : "Pending"}
              mutedIfPending
            />
            <BigConnector active={tDocsSent} />
            <BigProgressStep
              icon={I.circleCheck}
              done={tApproved}
              failed={tRejected}
              label={tRejected ? "Rejected" : "Approved"}
              sub={decidedByLabel ?? (tDecided ? "—" : "Awaiting decision")}
              mutedIfPending
            />
            <BigConnector active={tApproved} />
            <BigProgressStep
              icon={I.circleCheck}
              done={rfdReached}
              inProgress={tApproved && !rfdReached && !onHold}
              label="RFD"
              sub={rfdReached ? "Ready for disbursement" : tApproved ? "Awaiting tranche-1 docs" : "Pending"}
              mutedIfPending
            />
            <BigConnector active={rfdReached} />
            <BigProgressStep
              icon={I.money}
              done={firstDone}
              label="1st Disbursement"
              sub={firstDone ? fmtDateShort(loan.first_disbursement_date) : "Pending"}
              mutedIfPending
            />
            <BigConnector active={firstDone} />
            <BigProgressStep
              icon={I.check}
              done={secondDone}
              label="2nd Disbursement"
              sub={secondDone ? "Complete" : "Pending"}
              mutedIfPending
            />
          </div>
        </div>
        )}

        {/* ── DENSE GRID ────────────────────────────────────────────────── */}
        <div className="grid gap-3 lg:grid-cols-3 items-start">

          {/* COL 1 — applicant, co-applicant, employment & bank */}
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

            <SectionCard title="Installation site details" accent="blue" icon={I.building}>
              <KV k="Name on E-Bill" v={loan.ebill_name} />
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
                  <KV
                    k="Down payment"
                    v={loan.total_project_cost && loan.loan_amount_required
                      ? fmtRupees(Math.max(0, Number(loan.total_project_cost) - Number(loan.loan_amount_required)))
                      : null}
                  />
                  <KV k="System type" v={loan.system_type ? SYSTEM_LABEL[loan.system_type] ?? loan.system_type : null} />
                  <KV k="Monthly bill" v={fmtRupees(loan.monthly_bill_amount)} />
                  <KV k="DISCOM" v={loan.discom_name} />
                  <KV k="K Number" v={loan.ca_number} />
                </StepBlock>
              </div>
            </SectionCard>

            <SectionCard title="Employment & bank" tint icon={I.bank} adminOnly>
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

          {/* COL 2 — documents */}
          <div className="flex flex-col gap-3">
            <SectionCard title="Documents" accent="green" icon={I.files}>
              <div className="space-y-3">
                {docGroups.map((g) => {
                  // A tranche's Download button sits at the bottom of ITS group
                  // and shows only once every slot in that tranche is uploaded.
                  const complete = g.slots.length > 0 && g.slots.every((s) => !!s.docId || !!s.path);
                  const tranche: "1" | "2" | null =
                    g.title === "1st Tranche Docs" ? "1" : g.title === "2nd Tranche Docs" ? "2" : null;
                  return (
                    <StepBlock key={g.title} title={g.title}>
                      <DocGrid slots={toViewSlots(g)} eyeIcon={I.eye} />
                      {tranche && complete && (
                        <button
                          type="button"
                          disabled={trancheBusy !== null}
                          onClick={() => void downloadTranche(tranche)}
                          className="mt-3 text-[12px] font-semibold px-2.5 py-1.5 rounded-input inline-flex items-center gap-1.5 border border-[#178a5c]/30 bg-white text-[#178a5c] hover:bg-[#f0faf5] disabled:opacity-50"
                        >
                          {I.download} {trancheBusy === tranche ? "Preparing…" : `Download Tranche ${tranche}`}
                        </button>
                      )}
                    </StepBlock>
                  );
                })}
              </div>
            </SectionCard>
          </div>

          {/* COL 3 — decision, sanction, comments */}
          <div className="flex flex-col gap-3">
            {approvedPlus && approvalDetails && (
              <SectionCard title="Approval details" accent="green" icon={I.circleCheck} adminOnly>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="text-[14px]">
                    <span className="text-[#5a8a76] font-medium">Approved By: </span>
                    <span className="text-[#178a5c] font-bold">
                      {approvalDetails.approved_by
                        ? (LENDER_LABEL[String(approvalDetails.approved_by)] ?? String(approvalDetails.approved_by))
                        : (decidedByLabel ?? "—")}
                    </span>
                  </div>
                  {/* Credit score — small box, top-right corner. */}
                  <div className="shrink-0 text-center rounded-[8px] border border-[#cdeadd] bg-[#f0faf5] px-3 py-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-[#5a8a76]">Credit score</div>
                    <div className="text-[15px] font-bold text-[#0f3d2e] leading-tight">
                      {loan.credit_score != null ? loan.credit_score : "None"}
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[14px] border-collapse">
                    <thead>
                      <tr className="border-b border-[#e0f0e8]">
                        <th className="py-1.5 pr-4 text-left font-medium text-[#5a8a76]"></th>
                        <th className="py-1.5 px-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#8ab3a1]">Applied</th>
                        <th className="py-1.5 px-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#178a5c]">Approved</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: "Loan Amount", applied: approvalDetails.applied_loan_amount, approved: approvalDetails.approved_loan_amount, money: true, suffix: undefined as string | undefined },
                        { label: "Tenure",      applied: approvalDetails.applied_tenure_years, approved: approvalDetails.approved_tenure_years, money: false, suffix: "years" },
                        { label: "EMI",         applied: approvalDetails.tentative_emi,         approved: approvalDetails.approved_emi,         money: true, suffix: undefined },
                      ].map((r) => (
                        <tr key={r.label} className="border-b border-[#e0f0e8] last:border-0">
                          <td className="py-2 pr-4 text-[#5a8a76] font-medium">{r.label}</td>
                          {/* Applied = muted; Approved = bold dark. */}
                          <td className="py-2 px-3 text-right font-medium text-[#9aa5a0]">{fmtApproval(r.applied, r.money, r.suffix)}</td>
                          <td className="py-2 px-3 text-right font-bold text-[#0f3d2e]">{fmtApproval(r.approved, r.money, r.suffix)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[12px] text-[#5a8a76] mt-2">Recorded {fmtDate(loan.approved_at)} · read-only</p>
              </SectionCard>
            )}

            {approvedPlus && (
              <SectionCard title="Sanction details" accent="green" icon={I.money} adminOnly>
                {loan.sanction_letter_unavailable && (
                  <p className="text-[12px] text-[#854f0b] bg-[#fef8ee] border border-[#f3d9a4] rounded-[8px] px-3 py-2 mb-2">
                    Sanction letter was not available at the time of filling.
                  </p>
                )}
                <StepBlock title="1st Disbursement">
                  <KV k="Amount" v={fmtRupees(loan.first_disbursement_amount)} valueClass="text-[#178a5c]" />
                  <KV k="Date" v={fmtDateShort(loan.first_disbursement_date)} />
                  <div className="flex justify-between items-center text-[14px] py-[5px] gap-3">
                    <span className="text-[#5a8a76] shrink-0">Countdown to 2nd</span>
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
                      <span className="text-[#5a8a76] shrink-0">Documents review</span>
                      <span className={["inline-flex px-2 py-0.5 rounded-[6px] text-[12px] font-semibold",
                        reviewLabel === "Reviewed" ? "bg-[#e6f6ee] text-[#178a5c]" : "bg-[#fef0d6] text-[#854f0b]"].join(" ")}>
                        {reviewLabel}
                      </span>
                    </div>
                  </StepBlock>
                </div>
              </SectionCard>
            )}

            <SectionCard title="Comments" tint icon={I.lock} adminOnly>
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
      {abortOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => { if (!statusBusy) setAbortOpen(false); }}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-white rounded-lg shadow-lg p-6">
            <h3 className="font-semibold text-[18px] text-[#0f3d2e]">Abort application</h3>
            <p className="text-[12px] text-[#5a8a76] mt-0.5">Cancels this application. It stays on record (not deleted) and can&apos;t be edited afterwards. Record the reason.</p>
            <label className="block text-[13px] font-medium text-[#0f3d2e] mt-4 mb-1">Reason for abort <span className="text-red-600">*</span></label>
            <textarea
              value={abortReason}
              onChange={(e) => setAbortReason(e.target.value)}
              rows={3}
              placeholder="Why is this being aborted?"
              className="w-full rounded-input border border-red-200 bg-white px-3 py-2 text-[14px] text-[#0f3d2e] focus:outline-none focus:ring-2 focus:ring-red-200 resize-y"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setAbortOpen(false)} disabled={statusBusy}
                className="text-[13px] font-semibold px-3 py-2 rounded-[8px] border border-[#cdeadd] bg-white text-[#0f3d2e] hover:bg-[#f0faf5] disabled:opacity-60">
                Cancel
              </button>
              <button type="button" disabled={statusBusy || !abortReason.trim()}
                onClick={() => { const r = abortReason.trim(); if (!r) return; void doAbort(r).then(() => { setAbortOpen(false); setAbortReason(""); }); }}
                className="text-[13px] font-semibold px-3 py-2 rounded-[8px] bg-red-600 text-white hover:bg-red-700 disabled:opacity-60">
                Abort application
              </button>
            </div>
          </div>
        </div>
      )}
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

// ── Header action button — green-primary theme, soft shades. ─────────
function HAction({
  children, onClick, variant = "ghost", icon, disabled, title,
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: "approve" | "reject" | "primary" | "blue" | "amber" | "outline" | "ghost";
  icon?: ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  const cls =
    variant === "approve" ? "bg-[#e6f6ee] text-[#178a5c] border-[#cdeadd] hover:bg-[#d6efe3]" :
    variant === "reject"  ? "bg-red-50 text-red-700 border-red-200 hover:bg-red-100" :
    variant === "primary" ? "bg-[#178a5c] text-white border-[#178a5c] hover:bg-[#12734c]" :
    variant === "blue"    ? "bg-[#dceffb] text-[#185fa5] border-[#bfe0f5] hover:bg-[#cde6f8]" :
    variant === "amber"   ? "bg-[#fef8ee] text-[#854f0b] border-[#854f0b]/30 hover:bg-[#fef0d6]" :
    variant === "outline" ? "bg-white text-[#178a5c] border-[#cdeadd] hover:bg-[#f0faf5]" :
                            "bg-white text-[#0f3d2e] border-[#cdeadd] hover:bg-[#f0faf5]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={["text-[13px] font-semibold px-3 py-2 rounded-[8px] border transition-colors disabled:opacity-60 inline-flex items-center gap-1.5", cls].join(" ")}
    >
      {icon && <span className="shrink-0" style={{ display: "inline-flex" }}>{icon}</span>}
      {children}
    </button>
  );
}

// ── Status badge — the lender outcome, coloured. Names the deciding lender
// when we know it ("Approved by Aerem"), else falls back to the generic label.
function StatusBadge({ status, lender }: { status: string | null | undefined; lender?: string | null }) {
  const s = status ?? "draft";
  const generic = LOAN_STATUS_LABEL[s] ?? s;
  const label =
    lender && s === "approved" ? `Approved by ${lender}` :
    lender && s === "rejected" ? `Rejected by ${lender}` :
    generic;
  const cls =
    s === "approved" ? "bg-[#e6f6ee] text-[#178a5c] border-[#cdeadd]" :
    s === "rejected" ? "bg-red-50 text-red-700 border-red-200" :
    s === "docs_sent" ? "bg-[#dceffb] text-[#185fa5] border-[#bfe0f5]" :
    s === "rfd" ? "bg-[#d6efe3] text-[#0f7a52] border-[#bfe0d3]" :
    s === "on_hold" ? "bg-[#fff2cc] text-[#8a6500] border-[#f3d9a4]" :
    s === "aborted" ? "bg-red-50 text-red-700 border-red-200" :
    s === "under_review" ? "bg-[#fef0d6] text-[#854f0b] border-[#f3d9a4]" :
                       "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span className={["shrink-0 inline-flex px-2 py-0.5 rounded-full border text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap", cls].join(" ")}>
      {label}
    </span>
  );
}
