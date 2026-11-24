"use client";

// Loan Application — admin View profile.
//
// The progress stages are the tabs (Application · Lender · Approval ·
// Disbursement); the page opens on the case's current stage. The header holds
// ONE next-step button plus Edit and ⋮; owner + comments sit beside every tab.
// Chrome comes from @/components/view/ViewKit, same green design language as
// the EPC View.
//
// Read-only summary — "Edit" jumps to the chat / step forms. Disbursement entry
// stays on the dedicated /disbursement screen; this page only displays it.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import { authHeaders, getBusiness, isMainAdmin } from "@/lib/auth";
import { getDocumentUrl, deleteDocument, downloadDocument, triggerDownload, signLoanPath, saveDownload } from "@/lib/storage";
import ConfirmDeleteModal from "@/components/ConfirmDeleteModal";
import EditLoanDatesModal from "@/components/EditLoanDatesModal";
import { invalidate } from "@/lib/list-cache";
import CommentsSection from "@/components/CommentsSection";
import OwnershipCard from "@/components/OwnershipCard";
import { LoanActivityList } from "@/components/LoanActivityLogModal";
import { COMPLETION_CATEGORIES, TRANCHE1_DOCS } from "@/components/CompletionDocsSection";
import { type ApprovalDetails } from "@/components/ApprovalDetailsTable";
import LoanLenderPickerModal, { type PickerLender } from "@/components/LoanLenderPickerModal";
import LoanLenderStatusBox from "@/components/LoanLenderStatusBox";
import {
  LOAN_LENDER_COLS, lenderLabelIn, type LoanLenderRow,
  lendersWithDocs, approvedLenders,
} from "@/lib/loan-lenders";
import LenderPickerModal, { type LenderKey } from "@/components/LenderPickerModal";
import { useLenders } from "@/lib/lenders";
import EmailComposerModal from "@/components/EmailComposerModal";
import { DownloadMenu, KebabMenu } from "@/components/ProfileTabBar";
import { logLoanActivity } from "@/lib/loanAudit";
import { loanDocChecklist } from "@/lib/loan-doc-checklist";
import { loanChecks } from "@/lib/loan-verification";
import { cachedLoanUpdateCount } from "@/lib/use-epc-updates";
import { firstDisbursedShown } from "@/lib/disbursement";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { fmtRupees } from "@/lib/money";
import { initialsOf } from "@/lib/names";
import { invalidateLoanBoards } from "@/lib/ops-board";
import {
  I, DocViewer, FillCount, fillText, fillTone, HAction, ProgressTabs, CopyButton, Section, StatCards,
  type ViewDocSlot, type ViewerItem, type StageState,
} from "@/components/view/ViewKit";
import { useStacked } from "@/components/view/hooks";
import LoanApprovalForm from "@/components/LoanApprovalForm";
import ApprovalSummary from "@/components/ApprovalSummary";
import ReviewBar from "@/components/ReviewBar";
import { reviewState, canEditReview, reviewError } from "@/lib/review";
import LoanDisbursementPanel from "@/components/LoanDisbursementPanel";
// This page's own pieces (./_parts).
import { PATH_COLUMN, buildLoanDocGroups, type Doc, type Loan, type LoanDocGroup, type LoanSlot } from "./_parts/loan-docs";
import { LOAN_STATUS_LABEL, MSG_EPC, PAUSE, SHIELD, StatusBadge, displayId, fmtApproval } from "./_parts/labels";
import { SYSTEM_LABEL } from "@/lib/loan-labels";
import StatusLines from "./_parts/StatusLines";
import SubmittedTab, { type DupRow } from "./_parts/SubmittedTab";
import AbortModal from "./_parts/AbortModal";

// Signed URLs for every document, minted in ONE request (doc-urls) — pictures,
// the header photo and instant View. They live 1h; reuse them for 50 min.
type SignedUrls = { rows: Record<string, string>; paths: Record<string, string>; at: number };
const URL_TTL_MS = 50 * 60_000;

type Stage = "submitted" | "docs" | "approved" | "first" | "second";

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
  const searchParams = useSearchParams();
  const didAutoOpen = useRef(false);
  // Where "Back" should go. When you arrive from the Task Manager, we stash
  // "/admin/board" in sessionStorage so Back returns there, not the console.
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const lenders = useLenders();
  useEffect(() => { if (typeof window !== "undefined") setReturnTo(sessionStorage.getItem("ccReturnTo")); }, []);
  // Under xl the Submitted cards stack ABOVE Documents (their details open in place).
  const stacked = useStacked();
  function goBack() {
    const to = typeof window !== "undefined" ? sessionStorage.getItem("ccReturnTo") : null;
    if (to) { sessionStorage.removeItem("ccReturnTo"); router.push(to as unknown as string); }
    else router.push("/admin");
  }
  const [loan, setLoan] = useState<Loan | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusBusy, setStatusBusy] = useState(false);
  const [insBusy, setInsBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [trancheBusy, setTrancheBusy] = useState<null | "1" | "2">(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [docSentPickerOpen, setDocSentPickerOpen] = useState(false);
  const [changeLenderOpen, setChangeLenderOpen] = useState(false);
  const [zipPickerOpen, setZipPickerOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [abortOpen, setAbortOpen] = useState(false);
  const [abortReason, setAbortReason] = useState("");
  const [lenderRows, setLenderRows] = useState<LoanLenderRow[]>([]);
  // Bumped to re-read the file (and its docs) after a server-side change.
  const [reloadKey, setReloadKey] = useState(0);
  const [swapBusy, setSwapBusy] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);
  const [urls, setUrls] = useState<SignedUrls | null>(null);
  const [dups, setDups] = useState<DupRow[] | null>(null);
  // Open stage tab — null = the case's current stage; ?tab= opens one (Pendings → View).
  const [tab, setTab] = useState<Stage | null>(() => {
    const t = searchParams?.get("tab");
    return t && ["submitted", "docs", "approved", "first", "second"].includes(t) ? (t as Stage) : null;
  });
  // Lender whose approval form is open on the Approved stage (picked, or
  // "Change lender"); null = the saved / only lender.
  const [formLender, setFormLender] = useState<PickerLender | null>(null);
  // The main admin re-opened checked approval details to correct them (Pendings).
  const [approvalEdit, setApprovalEdit] = useState(false);
  // Document open in the in-page viewer (slot key).
  const [viewerKey, setViewerKey] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [{ data: la }, { data: dd }, { data: ll }] = await Promise.all([
        supabase().from("epc_applications")
          .select("*, epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)")
          .eq("id", params.id)
          .maybeSingle(),
        supabase().from("user_application_docs")
          .select("id, category, storage_path, file_name, mime_type, created_at")
          .eq("application_id", params.id),
        supabase().from("loan_application_lenders")
          .select(LOAN_LENDER_COLS)
          .eq("application_id", params.id)
          .order("docs_sent_at", { ascending: true }),
      ]);
      setLoan(la);
      const docRows = (dd ?? []) as Doc[];
      setDocs(docRows);
      setLenderRows((ll ?? []) as unknown as LoanLenderRow[]);
      setLoading(false);

      // ONE request signs every document — document pictures, instant View, and
      // the header photo (this replaced the header photo's own sign call).
      const res = await fetch(`/api/admin/loan-app/${params.id}/doc-urls`, {
        headers: authHeaders(),
      }).catch(() => null);
      const data = res?.ok ? await res.json().catch(() => null) : null;
      const signed: SignedUrls | null = data?.ok ? { rows: data.rows ?? {}, paths: data.paths ?? {}, at: Date.now() } : null;
      setUrls(signed);
      // Applicant photo, else the face cropped from the borrower's Aadhaar.
      const photoDoc = docRows.find((d) => d.category === "customer_photo");
      setPhotoUrl(
        photoDoc ? signed?.rows[photoDoc.id] ?? null
        : la?.aadhaar_face_path ? signed?.paths[la.aadhaar_face_path as string] ?? null
        : null,
      );
    })();
  }, [params.id, reloadKey]);

  // Duplicate check — another application with the same mobile, PAN or K number
  // (the same roof financed twice). One small query per profile open; it re-runs
  // only if one of those three values changes, never on focus.
  const dupMobile = loan?.borrower_mobile as string | undefined;
  const dupPan = loan?.borrower_pan as string | undefined;
  const dupCa = loan?.ca_number as string | undefined;
  useEffect(() => {
    if (!loan?.id) return;
    const or = ([["borrower_mobile", dupMobile], ["borrower_pan", dupPan], ["ca_number", dupCa]] as const)
      .map(([c, v]) => [c, String(v ?? "").trim().replace(/"/g, "")] as const)
      .filter(([, v]) => v.length >= 4)
      .map(([c, v]) => `${c}.eq."${v}"`);
    if (!or.length) { setDups([]); return; }
    void supabase().from("epc_applications")
      .select("id, loan_display_id, aadhaar_name, borrower_name, status, aborted_at, created_at, borrower_mobile, borrower_pan, ca_number")
      .or(or.join(","))
      .neq("id", loan.id)
      .order("created_at", { ascending: false })
      .limit(5)
      .then(({ data }: { data: DupRow[] | null }) => setDups(data ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loan?.id, dupMobile, dupPan, dupCa]);

  // Deep-link from the Task Manager (change #10): dragging a loan into a stage
  // opens the real workflow popup here (?do=docsent | reject | abort). Approve
  // and disbursement go to their own pages, so they need no flag.
  useEffect(() => {
    if (loading || !loan || didAutoOpen.current) return;
    const doParam = searchParams?.get("do");
    if (!doParam) return;
    didAutoOpen.current = true;
    if (doParam === "docsent") setDocSentPickerOpen(true);
    else if (doParam === "reject") setRejectOpen(true);
    else if (doParam === "abort") setAbortOpen(true);
    router.replace(`/admin/app/${params.id}/view` as any); // strip the flag so refresh/back won't reopen
  }, [loading, loan, searchParams, router, params.id]);

  const applicantName = useMemo(
    // Prefer the KYC (Aadhaar) name — it's the verified applicant. borrower_name
    // can be a stale lead name (e.g. when a lead was converted to a loan app),
    // which used to make this header disagree with the identity card below.
    () => loan?.aadhaar_name || loan?.borrower_name || "(unnamed applicant)",
    [loan],
  );
  const epcName = useMemo(() => {
    if (!loan?.epc_business) return "—";
    return loan.epc_business.trade_name || loan.epc_business.legal_name || loan.epc_business.contact_name || "—";
  }, [loan]);
  const docGroups = useMemo(() => (loan ? buildLoanDocGroups(loan, docs) : []), [loan, docs]);

  // A URL from the one-shot doc-urls batch while it's still valid, else null.
  const fresh = (u: string | undefined) => (u && urls && Date.now() - urls.at < URL_TTL_MS ? u : null);

  const urlForDoc = async (id: string) => fresh(urls?.rows[id]) ?? await getDocumentUrl(id);
  const urlForPath = async (path: string) => fresh(urls?.paths[path]) ?? await signLoanPath(params.id, path);

  async function openDoc(id: string) {
    const url = await urlForDoc(id);
    if (url) window.open(url, "_blank", "noopener");
  }

  const downloadDoc = downloadDocument;

  async function openPath(path: string) {
    const url = await urlForPath(path);
    if (url) window.open(url, "_blank", "noopener");
  }

  async function downloadPath(path: string) {
    const u = await signLoanPath(params.id, path, { download: true });
    if (u) triggerDownload(u);
  }

  // Remove a doc-row-backed document (user_application_docs) — DocGrid has
  // already confirmed, and shows the button to the owner only.
  async function removeDocRow(docId: string) {
    const ok = await deleteDocument(docId);
    if (!ok) { alert("Couldn't remove the document."); return; }
    setDocs((arr) => arr.filter((d) => d.id !== docId));
  }

  // Remove a *_path-backed document via the admin-only route (nulls the column
  // + deletes exactly that GCS object + writes activity log) — after DocGrid's confirm.
  async function removePathDoc(column: string) {
    try {
      const res = await fetch("/api/admin/delete-doc-path", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ table: "epc_applications", id: params.id, column }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) { alert("Couldn't remove: " + (data?.error || res.status)); return; }
      setLoan((prev: Loan | null) => (prev ? { ...prev, [column]: null } : prev));
    } catch (e) {
      alert("Couldn't remove: " + (e as Error).message);
    }
  }

  const isPdf = (s: LoanSlot) => /pdf/i.test(s.mime ?? "") || /\.pdf$/i.test(s.file ?? "");

  function toViewSlots(g: LoanDocGroup): ViewDocSlot[] {
    return g.slots.map((s) => ({
      key: s.key,
      label: s.label,
      title: s.file?.split("/").pop(),
      onView: s.docId || s.path ? () => setViewerKey(s.key) : undefined,
      onDownload: s.docId
        ? () => void downloadDoc(s.docId!)
        : s.path
        ? () => void downloadPath(s.path!)
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
      setStatusMsg("Couldn't update status — " + reviewError(error.message));
      setStatusBusy(false);
      return;
    }
    setLoan({ ...loan, ...patch });
    invalidateLoanBoards(); // Task Manager / Loans list / KPIs re-read on next open
    setStatusMsg("Status updated.");
    await logLoanActivity(loan.id, next === "approved" ? "approved" : next === "rejected" ? "rejected" : "status_change", {
      detail: note || `Status → ${LOAN_STATUS_LABEL[next] ?? next}`,
    });
    setStatusBusy(false);
  }

  // Insurance — makes this loan's insurance profile from its data the first
  // time; afterwards fills only what that profile is still missing, then opens it.
  async function openInsurance() {
    if (!loan || insBusy) return;
    if (!loan.insurance_application_id && !window.confirm("Make the insurance profile from this application?")) return;
    setInsBusy(true);
    try {
      const res = await fetch(`/api/admin/loan-app/${loan.id}/insurance`, { method: "POST", headers: authHeaders() });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) { alert("Couldn't open the insurance profile — " + (d?.error || `HTTP ${res.status}`)); return; }
      router.push(`/admin/insurance/${d.id}/view` as any);
    } finally {
      setInsBusy(false);
    }
  }

  async function downloadZip(lender: LenderKey) {
    if (!loan || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/admin/loan-app/${loan.id}/download-zip?lender=${lender}`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert("ZIP failed: " + (d?.error || `HTTP ${res.status}`));
        return;
      }
      await saveDownload(res, `${displayId(loan)}_${String(applicantName).replace(/[^\w-]+/g, "_")}.zip`);
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
        headers: authHeaders(),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert("Download failed: " + (d?.error || `HTTP ${res.status}`));
        return;
      }
      await saveDownload(res, `${displayId(loan)}_Tranche${tranche}.zip`);
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

  const rejected    = loan.status === "rejected";
  const underReview = loan.status === "under_review";
  const statusVal   = loan.status ?? "draft";
  const hasCoapp    = loan.bill_on_applicant_name === false;
  const aborted     = loan.aborted_at != null;
  // Approval-and-beyond (includes RFD).
  const approvedPlus   = ["approved", "rfd", "sent_to_nbfc", "disbursed"].includes(statusVal);
  const approvalFilled = loan.approval_details_filled === true;

  const decidedLender = approvedPlus ? loan.approved_lender : rejected ? loan.rejected_lender : null;
  const decidedByLabel = decidedLender ? lenderLabelIn(lenders, String(decidedLender)) : null;
  const approvalDetails = (loan.approval_details ?? null) as ApprovalDetails | null;

  const firstDone  = loan.first_disbursement_amount != null;
  const secondDone = loan.second_disbursement_amount != null;

  const docsSent = loan.status === "docs_sent";
  const onHold   = loan.status === "on_hold";

  // Node 1 "Submitted" completes only when every step 1–4 application doc is
  // present (tranche/completion docs excluded) — mirrors the dashboard's
  // loanDocsPending. The Docs Sent button stays gated on this.
  // Every document through Step 4 is REQUIRED to enable Doc Sent — Applicant PAN
  // + Applicant photo + Aadhaar (front/back) [Steps 1–2], Quotation + Electricity
  // bill + Rooftop photo [Step 3], Bank statement [Step 4], and the co-applicant
  // KYC when there is a co-applicant. One shared rule (lib/loan-doc-checklist)
  // with the loan table's docs badge. Sanction Letter / Tranche docs come later
  // and are NOT required here.
  const hasCat = (c: string) => docs.some((d) => d.category === c);
  const appDocsComplete = loanDocChecklist(loan, docs.map((d) => d.category)).every((d) => d.ok);

  // ── Per-lender (loan_application_lenders) derived state ──────────────
  const withDocs = lendersWithDocs(lenderRows);
  const approvedRows = approvedLenders(lenderRows);
  const anyApprovedLender = approvedRows.length > 0;
  const anyLenderActivity = lenderRows.some((r) => r.docs_sent_at || r.approved_at || r.rejected_at);
  // Every lender the portal works with (the registry) + any on this file that
  // isn't active any more.
  const allLenderOptions: PickerLender[] = [
    ...lenders,
    ...lenderRows
      .filter((r) => !lenders.some((d) => d.key === r.lender_key))
      .map((r) => ({ key: r.lender_key, label: r.lender_label })),
  ];
  // Lenders that can still be sent docs (minus already-sent).
  const availableForDocSent = allLenderOptions.filter((l) => !lenderRows.some((r) => r.lender_key === l.key && r.docs_sent_at));
  const withDocsOptions: PickerLender[] = withDocs.map((r) => ({ key: r.lender_key, label: r.lender_label }));
  // "Change lender" offers ALL of them, so the admin can finalize a DIFFERENT
  // lender (e.g. CF rejected, Solfin approved) even one with no docs sent yet.

  // Tracker reads an "effective" status so a held case still shows where it
  // was parked (Resume returns it there).
  const effStatus = onHold ? (loan.status_before_hold ?? "under_review") : statusVal;
  // A recorded disbursement implies docs were sent AND a lender approved, even if
  // the headline status was never synced (legacy/inconsistent rows) — so the
  // tracker reads coherently instead of showing "disbursed" with "Approved" blank.
  const tDocsSent = firstDone || ["docs_sent", "approved", "rfd", "rejected", "sent_to_nbfc", "disbursed"].includes(effStatus);
  const tApproved = firstDone || ["approved", "rfd", "sent_to_nbfc", "disbursed"].includes(effStatus);
  const tRejected = !firstDone && effStatus === "rejected";

  // Tranche ZIPs are offered in the Download menu only when that tranche's
  // documents actually exist (no empty-tranche ZIP).
  const tranche1Exists = docs.some((d) => ["feasibility_report", "mmr_advance_receipt"].includes(d.category));
  const tranche2Exists = docs.some((d) =>
    ["completion_invoice", "completion_panel_photo", "completion_inverter_photo", "completion_meter_photo", "completion_report"].includes(d.category),
  );

  // Change review — undo the current lender decision (and any abort) and move
  // the application back to Docs Sent so the admin can Approve/Reject again.
  // Fixes cases mistakenly marked Approved/Rejected by lender.
  const changeReview = async () => {
    if (!loan || statusBusy) return;
    if (!window.confirm(
      "Change the review?\n\nThis undoes the current lender decision (and any abort) and moves the application back to Docs Sent, where you can Approve or Reject again.",
    )) return;
    // The lenders' own rows carry the decision too: clear them first, or the
    // Lenders box keeps the old decision and the next lender action puts the
    // status straight back. Docs-sent times and approval details stay.
    if (lenderRows.some((r) => r.approved_at || r.rejected_at)) {
      const cleared = { approved_at: null, rejected_at: null, rejection_reason: null, approval_recorded_at: null };
      const { error } = await supabase().from("loan_application_lenders").update(cleared).eq("application_id", loan.id);
      if (error) { setStatusMsg("Couldn't change the review — " + reviewError(error.message)); return; }
      setLenderRows((rows) => rows.map((r) => ({ ...r, ...cleared })));
    }
    void changeStatus("docs_sent", {
      approved_lender: null, approved_at: null,
      rejected_lender: null, rejected_at: null,
      rfd_at: null, approval_details_filled: false,
      aborted_at: null, abort_reason: null,
    }, "Review changed — reverted to Docs Sent");
  };

  // Three-dot overflow menu (replaces the bare trash button). "Change review"
  // only appears once there's a decision/abort to undo. Change lender and the
  // applicant ↔ co-applicant swap are the main admin's only.
  const canChangeReview = approvedPlus || rejected || aborted || anyLenderActivity;
  const mainAdmin = isMainAdmin(getBusiness());
  const canHold = (underReview || docsSent) && !anyApprovedLender;
  const kebabItems = [
    {
      label: downloading ? "Preparing…" : "Download ZIP",
      icon: I.download,
      onClick: () => { if (!downloading) setZipPickerOpen(true); },
    },
    ...(["1", "2"] as const).filter((t) => (t === "1" ? tranche1Exists : tranche2Exists)).map((t) => ({
      label: trancheBusy === t ? "Preparing…" : `Download Tranche ${t}`,
      icon: I.download,
      onClick: () => { if (!trancheBusy) void downloadTranche(t); },
    })),
    ...(canHold && !onHold && !aborted ? [{
      label: "Put on hold",
      icon: PAUSE,
      onClick: () => holdCase(),
    }] : []),
    ...(!aborted ? [{
      label: "Abort application",
      icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></svg>),
      onClick: () => setAbortOpen(true),
    }] : []),
    ...(canChangeReview ? [{
      label: "Change review",
      icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>),
      onClick: changeReview,
    }] : []),
    ...(mainAdmin && (canChangeReview || withDocs.length > 0) && !aborted ? [{
      label: "Change lender",
      icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5" /><path d="M21 3l-7 7" /><path d="M8 21H3v-5" /><path d="M3 21l7-7" /></svg>),
      onClick: () => setChangeLenderOpen(true),
    }] : []),
    ...(mainAdmin && hasCoapp && !aborted ? [{
      label: swapBusy ? "Swapping…" : "Swap applicant ↔ co-applicant",
      icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4v16M7 4 3 8M7 4l4 4" /><path d="M17 20V4M17 20l-4-4M17 20l4-4" /></svg>),
      onClick: () => { if (!swapBusy) void swapRoles(); },
    }] : []),
    ...(mainAdmin ? [{
      label: "Edit dates",
      icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>),
      onClick: () => setDatesOpen(true),
    }] : []),
    // Deleting a loan application is the owner's (Pri) only — the route re-checks.
    ...(getBusiness()?.is_owner ? [{
      label: "Delete",
      icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>),
      onClick: () => setDelOpen(true),
      danger: true,
    }] : []),
  ];

  // ── Per-lender actions ───────────────────────────────────────────────
  async function reloadLenders(): Promise<LoanLenderRow[]> {
    const { data } = await supabase()
      .from("loan_application_lenders").select(LOAN_LENDER_COLS)
      .eq("application_id", params.id).order("docs_sent_at", { ascending: true });
    const rows = (data ?? []) as unknown as LoanLenderRow[];
    setLenderRows(rows);
    return rows;
  }

  // Keep epc_applications.status at the FURTHEST state (approval sticks) so the
  // tracker + disbursement keep working; the dashboard headline shows the LATEST
  // event separately (computed from the per-lender rows).
  async function syncHeadline(rows: LoanLenderRow[]) {
    if (!loan) return;
    const approvedNow = rows.filter((r) => r.approved_at);
    // "Docs pending" = a lender that has docs sent but is NOT yet decided. A
    // REJECTED lender's row still carries docs_sent_at, so this must exclude
    // approved/rejected rows — otherwise a lender rejection could never move the
    // headline to "rejected" (it stayed stuck at "docs_sent").
    const anyPending = rows.some((r) => r.docs_sent_at && !r.approved_at && !r.rejected_at);
    const rejectedRows = rows.filter((r) => r.rejected_at);
    let next: string = loan.status ?? "under_review";
    if (approvedNow.length) next = "approved";
    else if (anyPending) next = "docs_sent";
    else if (rejectedRows.length) next = "rejected";
    const latestApproved = approvedNow.slice().sort((a, b) => (String(b.approved_at) > String(a.approved_at) ? 1 : -1))[0]?.lender_key ?? null;
    const patch: Record<string, unknown> = { status: next };
    if (approvedNow.length) patch.approved_lender = latestApproved;
    // When the case lands on "rejected" (every lender rejected, none approved),
    // reflect the latest lender rejection onto the application itself so BOTH the
    // admin table and the EPC portal (status + timeline reason) show it.
    if (next === "rejected") {
      const latestRej = rejectedRows.slice().sort((a, b) => (String(b.rejected_at) > String(a.rejected_at) ? 1 : -1))[0];
      patch.rejected_lender = latestRej?.lender_key ?? null;
      patch.rejected_at = latestRej?.rejected_at ?? new Date().toISOString();
      patch.rejection_reason = latestRej?.rejection_reason ?? null;
    }
    const { error } = await supabase().from("epc_applications").update(patch).eq("id", loan.id);
    if (error) throw new Error(reviewError(error.message)); // callers show it as "Couldn't record: …"
    setLoan((prev) => (prev ? ({ ...prev, ...patch } as Loan) : prev));
    invalidateLoanBoards(); // docs-sent / approve / reject reflect on next board/list open
  }

  async function sendDocsToLender(lender: PickerLender) {
    if (!loan || statusBusy) return;
    setStatusBusy(true); setStatusMsg(null);
    try {
      const existing = lenderRows.find((r) => r.lender_key === lender.key);
      if (existing) {
        if (!existing.docs_sent_at) {
          const { error } = await supabase().from("loan_application_lenders").update({ docs_sent_at: new Date().toISOString() }).eq("id", existing.id);
          if (error) throw new Error(error.message);
        }
      } else {
        const { error } = await supabase().from("loan_application_lenders").insert({ application_id: loan.id, lender_key: lender.key, lender_label: lender.label, docs_sent_at: new Date().toISOString() });
        if (error) throw new Error(error.message);
      }
      const rows = await reloadLenders();
      await logLoanActivity(loan.id, "status_change", { detail: `Docs sent to ${lender.label}` });
      await syncHeadline(rows);
      setStatusMsg(`Docs sent to ${lender.label}.`);
    } catch (e) { setStatusMsg("Couldn't record: " + (e as Error).message); }
    finally { setStatusBusy(false); }
  }

  // Approve opens the approval-details form for that lender right here, on the
  // Approved stage; saving writes the lender's approved_at + approval_details.
  function approvePickLender(lender: PickerLender) {
    setApproveOpen(false);
    setChangeLenderOpen(false);
    setFormLender(lender);
    setTab("approved");
  }

  // Re-read just the loan row (after a disbursement / review save).
  async function reloadLoan() {
    const { data } = await supabase().from("epc_applications")
      .select("*, epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)")
      .eq("id", params.id)
      .maybeSingle();
    if (data) setLoan(data);
  }

  async function rejectLenderNow(lender: PickerLender, reason?: string, date?: string) {
    if (!loan || statusBusy) return;
    setStatusBusy(true); setStatusMsg(null);
    try {
      // Use the admin-entered rejection date (local midnight) when provided; else now.
      const rejectedAt = date ? new Date(`${date}T00:00:00`).toISOString() : new Date().toISOString();
      const existing = lenderRows.find((r) => r.lender_key === lender.key);
      const patch = { rejected_at: rejectedAt, rejection_reason: reason || null, approved_at: null, approval_details: null };
      const { error } = existing
        ? await supabase().from("loan_application_lenders").update(patch).eq("id", existing.id)
        : await supabase().from("loan_application_lenders").insert({ application_id: loan.id, lender_key: lender.key, lender_label: lender.label, docs_sent_at: new Date().toISOString(), ...patch });
      if (error) throw new Error(error.message);
      const rows = await reloadLenders();
      await logLoanActivity(loan.id, "rejected", { detail: `Rejected by ${lender.label}${reason ? ` — ${reason}` : ""}` });
      await syncHeadline(rows);
      setStatusMsg(`Rejected by ${lender.label}${reason ? ` — ${reason}` : ""}.`);
    } catch (e) { setStatusMsg("Couldn't record: " + (e as Error).message); }
    finally { setStatusBusy(false); }
  }

  // Finalize one approved lender — it becomes approved_lender and drives
  // disbursement (its approved amount → sanctioned_amount). Reuses the existing
  // columns, so the rest of the app is unchanged.
  async function finalizeLender(key: string) {
    if (!loan || statusBusy) return;
    const row = lenderRows.find((r) => r.lender_key === key && r.approved_at);
    if (!row) return;
    const d = (row.approval_details ?? {}) as Record<string, unknown>;
    setStatusBusy(true); setStatusMsg(null);
    try {
      const patch: Record<string, unknown> = {
        approved_lender: key,
        approval_details: d,
        sanctioned_amount: (d.approved_loan_amount as number | null) ?? loan.sanctioned_amount ?? null,
        credit_score: (d.credit_score as number | null) ?? null,
        credit_ntc: d.credit_ntc === true,
      };
      const { error } = await supabase().from("epc_applications").update(patch).eq("id", loan.id);
      if (error) throw new Error(reviewError(error.message)); // locked approval details (Pendings)
      setLoan((prev) => (prev ? ({ ...prev, ...patch } as Loan) : prev));
      await logLoanActivity(loan.id, "status_change", { detail: `Finalized ${row.lender_label} for disbursement` });
      setStatusMsg(`${row.lender_label} finalized.`);
    } catch (e) { setStatusMsg("Couldn't finalize: " + (e as Error).message); }
    finally { setStatusBusy(false); }
  }
  const holdCase = () =>
    void changeStatus("on_hold", { hold_at: new Date().toISOString(), status_before_hold: loan.status }, "Put on hold");
  const resumeHold = () => {
    const prior = (loan.status_before_hold as string) || "under_review";
    void changeStatus(prior, { hold_at: null, status_before_hold: null }, `Resumed to ${LOAN_STATUS_LABEL[prior] ?? prior}`);
  };
  // Abort — a recorded soft-cancel (not a delete, not a status change). Keeps
  // the underlying status; the aborted_at flag makes it read as "Aborted".
  async function doAbort(reason: string): Promise<boolean> {
    if (!loan || statusBusy) return false;
    setStatusBusy(true);
    setStatusMsg(null);
    const me = getBusiness();
    const by = me?.contact_name || "admin";
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { aborted_at: now, abort_reason: reason, reviewed_by: by, reviewed_at: now };
    // Aborting is terminal — don't leave the case parked "on hold" (that made the
    // Task Manager still show it as On hold). Restore its pre-hold status and clear
    // the hold overlay so nothing reads it as on_hold anymore.
    if (loan.status === "on_hold") {
      patch.status = loan.status_before_hold || "under_review";
      patch.hold_at = null;
      patch.status_before_hold = null;
    }
    const { error } = await supabase().from("epc_applications").update(patch).eq("id", loan.id);
    if (error) { setStatusMsg("Couldn't abort — " + error.message); setStatusBusy(false); return false; }
    setLoan({ ...loan, ...patch });
    invalidateLoanBoards(); // abort reflects on the Task Manager / Loans list immediately
    setStatusMsg("Application aborted.");
    await logLoanActivity(loan.id, "status_change", { detail: `Aborted — ${reason}` });
    setStatusBusy(false);
    return true;
  }

  // Swap applicant ↔ co-applicant. The route moves every identity field and the
  // two PAN files and re-files the photo / bank statement as "other", so the
  // whole file (and its docs) is re-read afterwards.
  async function swapRoles() {
    if (!loan || swapBusy || !window.confirm(
      "Swap applicant ↔ co-applicant?\n\nThe photo and bank statement will move to Other documents and should be re-collected for the new applicant.",
    )) return;
    setSwapBusy(true);
    try {
      const res = await fetch(`/api/admin/loan-app/${loan.id}/swap-roles`, {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) { alert("Couldn't swap: " + (data?.error || res.status)); return; }
      setReloadKey((k) => k + 1);
      invalidateLoanBoards(); // applicant name changes on the board / Loans list
    } catch (e) {
      alert("Couldn't swap: " + (e as Error).message);
    } finally {
      setSwapBusy(false);
    }
  }

  // ── Progress bar = tabs ─────────────────────────────────────────────
  // The five stage circles ARE the tabs. Click one to open that stage:
  // Submitted = the whole application; Docs Sent = lenders; Approved = the
  // approval-details form; 1st / 2nd Disbursement = that tranche's documents and
  // amount — each showing what's filled and what isn't. Opens on the current stage.
  const checklist = loanDocChecklist(loan, docs.map((d) => d.category));
  const docsHave = checklist.filter((d) => d.ok).length;
  // Tranche documents on file (same required sets as the disbursement stages).
  const docCats = new Set(docs.map((d) => d.category));
  const t1Need = TRANCHE1_DOCS.filter((d) => !(loan.approved_lender === "solfin" && d.category === "mmr_advance_receipt"));
  const t1Have = t1Need.filter((d) => docCats.has(d.category)).length;
  const t2Have = COMPLETION_CATEGORIES.filter((c) => docCats.has(c)).length;
  const stageNow: Stage =
    !tDocsSent ? (appDocsComplete ? "docs" : "submitted")
    : !tApproved ? "approved"
    : !firstDone ? "first"
    : "second";
  const held = (s: Stage, st: StageState): StageState => (onHold && s === stageNow ? "hold" : st);
  // When each finished step happened (date + time). Disbursements carry only
  // the disbursement date the admin enters, so those show the date alone.
  const sentAt = lenderRows.find((r) => r.docs_sent_at)?.docs_sent_at ?? null;
  // Approved: the Date of Approval entered on the approval form (a date — the
  // lender row's approved_at is only when it was recorded in the portal).
  const decidedWhen = tApproved
    ? (approvalDetails?.approval_date ? fmtDate(approvalDetails.approval_date) : loan.approved_at ? fmtDateTime(loan.approved_at) : null)
    : tRejected && loan.rejected_at ? fmtDateTime(loan.rejected_at) : null;
  const withWhen = (what: ReactNode, when: string | null) => (when ? <>{what}<br />{when}</> : what);
  const stages: Array<{ key: Stage; label: string; sub?: ReactNode; icon: ReactNode; state: StageState }> = [
    {
      key: "submitted", label: "Submitted", icon: I.send,
      state: held("submitted", appDocsComplete ? "done" : "current"),
      sub: appDocsComplete ? (loan.submitted_at ? fmtDateTime(loan.submitted_at) : "Complete") : <><FillCount have={docsHave} total={checklist.length} /> documents</>,
    },
    {
      key: "docs", label: "Docs Sent", icon: I.files,
      state: held("docs", tDocsSent ? "done" : appDocsComplete ? "current" : "pending"),
      sub: tDocsSent ? (sentAt ? fmtDateTime(sentAt) : "Sent to lender") : onHold ? "On hold" : appDocsComplete ? "Ready to send" : "Pending",
    },
    {
      key: "approved", label: tRejected ? "Rejected" : "Approved", icon: I.circleCheck,
      state: held("approved", tApproved ? "done" : tRejected ? "failed" : tDocsSent ? "current" : "pending"),
      sub: decidedByLabel ? withWhen(decidedByLabel, decidedWhen) : tDocsSent ? "Awaiting decision" : "Pending",
    },
    {
      key: "first", label: "1st Disbursement", icon: I.money,
      state: held("first", firstDone ? "done" : tApproved ? "current" : "pending"),
      sub: firstDone ? fmtDate(loan.first_disbursement_date) : tApproved ? <><FillCount have={t1Have} total={t1Need.length} /> documents</> : "Pending",
    },
    {
      key: "second", label: "2nd Disbursement", icon: I.check,
      state: held("second", secondDone ? "done" : firstDone ? "current" : "pending"),
      sub: secondDone ? fmtDate(loan.second_disbursement_date) : firstDone ? <><FillCount have={t2Have} total={COMPLETION_CATEGORIES.length} /> documents</> : "Pending",
    },
  ];
  const activeTab: Stage = tab ?? stageNow;
  const canAct = !aborted && !onHold;

  const sendButton = (primary: boolean) => (
    <HAction
      variant={primary ? "primary" : "outline"}
      icon={I.send}
      disabled={statusBusy || !appDocsComplete}
      title={appDocsComplete ? undefined : "Upload all required documents first"}
      onClick={() => setSendOpen(true)}
    >
      Send to lender
    </HAction>
  );

  // ── Approved stage — which lender's approval form to show ───────────
  // The saved (finalized) lender's details open for editing; before approval,
  // the only lender with the documents opens straight away, else "Approved by
  // lender" asks which one.
  const savedLender: PickerLender | null = approvedPlus && loan.approved_lender
    ? {
        key: String(loan.approved_lender),
        label: lenderRows.find((r) => r.lender_key === loan.approved_lender)?.lender_label ?? lenderLabelIn(lenders, String(loan.approved_lender)),
      }
    : null;
  const formFor: PickerLender | null =
    formLender ?? savedLender ?? (!tRejected && withDocsOptions.length === 1 ? withDocsOptions[0] : null);
  const formEdit: "approval" | null = savedLender && formFor?.key === savedLender.key ? "approval" : null;
  const approveNow = () => (withDocsOptions.length === 1 ? approvePickLender(withDocsOptions[0]) : setApproveOpen(true));
  // Pendings: saved approval details are read-only once saved — for the team
  // until the admin sends them back, for the main admin until he clicks Edit.
  const approvalLocked = approvalFilled && (mainAdmin
    ? reviewState(loan, "approval") != null && !approvalEdit
    : !canEditReview(loan, "approval"));
  const mergeReview = (patch: Record<string, string | null>) => {
    setLoan((prev) => (prev ? ({ ...prev, ...patch } as Loan) : prev));
    invalidateLoanBoards();
  };

  // Edit the application itself; each stage's details are edited in its stage.
  const editItems = aborted ? [] : [
    // Chatbot — asks only for what's still missing.
    { label: "Continue in chat", onClick: () => router.push(`/admin/app/intake?app=${loan.id}&edit=1` as any) },
    // The classic step-by-step wizard.
    { label: "Edit in form", onClick: () => router.push(`/admin/app/${loan.id}/step-1` as any) },
  ];
  // This admin's unread EPC replies — from the console's cache, never a fetch.
  const msgCount = cachedLoanUpdateCount(loan.id);

  // ── Checks (data already on the row — no request) ───────────────────
  const checks = loanChecks(loan, docs.map((d) => d.category), {
    approved: approvedPlus, decided: approvedPlus || rejected, duplicates: dups ? dups.length : null,
  });

  const approvedAmt = tApproved ? (loan.sanctioned_amount ?? approvalDetails?.approved_loan_amount ?? null) : null;
  // Credit Fair's 1st disbursement counts with its three charges (lib/disbursement).
  const disbursedAmt = (firstDisbursedShown(loan as Record<string, any>) ?? 0) + Number(loan.second_disbursement_amount ?? 0);
  const tranchesPaid = (firstDone ? 1 : 0) + (secondDone ? 1 : 0);
  const initials = initialsOf(applicantName);
  const kw = loan.project_size ? `${loan.project_size} ${String(loan.project_size_unit ?? "kw").toUpperCase()}` : null;

  // Every uploaded document, in page order — the viewer's previous / next.
  const viewerItems: ViewerItem[] = docGroups.flatMap((g) => g.slots).filter((s) => s.docId || s.path).map((s) => ({
    key: s.key,
    label: s.label,
    at: s.at ? fmtDateTime(s.at) : null,
    pdf: isPdf(s),
    getUrl: () => (s.docId ? urlForDoc(s.docId) : urlForPath(s.path!)),
    onOpen: () => void (s.docId ? openDoc(s.docId) : openPath(s.path!)),
    onDownload: () => void (s.docId ? downloadDoc(s.docId) : downloadPath(s.path!)),
  }));
  const viewerIndex = viewerKey ? viewerItems.findIndex((v) => v.key === viewerKey) : -1;

  return (
    <main className="min-h-screen bg-white">
      {/* ── HEADER — who it is, one quiet info line · plain buttons ── */}
      <header className="border-b border-[#eef3f1] bg-white/95 backdrop-blur sticky top-0 z-30">
        <div className="w-full px-5 sm:px-8 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3.5 min-w-0">
            <button
              onClick={goBack}
              title={returnTo === "/admin/board" ? "Back to Task Manager" : "Back to console"}
              aria-label={returnTo === "/admin/board" ? "Back to Task Manager" : "Back to console"}
              className="w-9 h-9 -ml-2 rounded-full grid place-items-center text-[#5a8a76] hover:bg-[#eef6f1] hover:text-[#0f3d2e] shrink-0"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            </button>
            <div className="w-12 h-12 rounded-full bg-[#e6f6ee] text-[#178a5c] grid place-items-center shrink-0 overflow-hidden text-[16px] font-semibold">
              {photoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={photoUrl} alt="" className="w-full h-full object-cover" style={{ imageOrientation: "from-image" }} />
              ) : (
                initials || I.user
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <h1 className="text-[22px] font-semibold text-[#0f3d2e] truncate leading-tight">{applicantName}</h1>
                <StatusBadge status={aborted ? "aborted" : loan.status} lender={decidedByLabel} />
              </div>
              <div className="flex items-center gap-2 mt-1 text-[13px] text-[#7a958a] min-w-0">
                <span className="group inline-flex items-center gap-1 font-medium text-[#185fa5] shrink-0">
                  {displayId(loan)}
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex"><CopyButton value={displayId(loan)} label="Copy loan ID" /></span>
                </span>
                <span className="truncate">
                  {[loan.system_type ? SYSTEM_LABEL[loan.system_type] ?? loan.system_type : null, kw, epcName].filter(Boolean).join("  ·  ")}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {onHold && !aborted && (
              <HAction variant="amber" icon={PAUSE} disabled={statusBusy} onClick={resumeHold}>Resume</HAction>
            )}
            <a
              href={`/admin/app/${loan.id}/messages`}
              title={loan.attention_status === "open" ? "Open issue with the EPC" : undefined}
              className="relative h-9 px-3 rounded-[8px] inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#178a5c] border border-[#cdeadd] bg-[#f4fbf7] hover:bg-[#e9f6ef] hover:border-[#9fd6bd]"
            >
              {MSG_EPC}
              Message EPC
              {msgCount > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold grid place-items-center">{msgCount}</span>
              ) : loan.attention_status === "open" ? (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-600" />
              ) : null}
            </a>
            {tApproved && !aborted && (
              <HAction variant="outline" icon={SHIELD} disabled={insBusy} onClick={() => void openInsurance()}>
                {insBusy ? "Opening…" : "Insurance"}
              </HAction>
            )}
            {editItems.length > 0 && <DownloadMenu label="Edit" icon={I.edit} items={editItems} />}
            <KebabMenu items={kebabItems} ghost />
          </div>
        </div>
        {/* Status lines: the last action, an abort, or ONE rejection reason
            (per-lender rows de-duplicated by text; the app-level reason is the
            fallback; hidden once a lender approves). */}
        <StatusLines statusMsg={statusMsg} rejected={rejected} aborted={aborted} loan={loan} lenderRows={lenderRows} />
      </header>

      <div className="w-full px-5 sm:px-8" style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#0f3d2e" }}>
        {/* ── Key numbers ── */}
        <div className="pt-6 pb-2">
          <StatCards
            items={[
              { label: "Loan applied", value: fmtRupees(loan.loan_amount_required) },
              { label: "Approved", value: approvedAmt != null ? fmtRupees(approvedAmt) : "—", sub: approvedAmt != null ? decidedByLabel ?? undefined : undefined, tone: approvedAmt != null ? "text-[#178a5c]" : "text-[#c3cbc7]" },
              { label: "Disbursed", value: disbursedAmt > 0 ? fmtRupees(disbursedAmt) : "—", sub: tApproved ? `${tranchesPaid} of 2 tranches` : undefined, tone: disbursedAmt > 0 ? "text-[#185fa5]" : "text-[#c3cbc7]" },
              { label: "Documents", value: fillText(docsHave, checklist.length), tone: fillTone(docsHave, checklist.length) },
            ]}
          />
        </div>

        {/* ── PROGRESS BAR = TABS ── */}
        <div className="pt-7 pb-2 border-b border-[#eef3f1]">
          <ProgressTabs items={stages} value={activeTab} onChange={(k) => setTab(k as Stage)} />
        </div>

        {/* Three equal columns, as before: the stage body spans two, the side
            one. The Submitted body splits its two with the SAME gap, so cards,
            documents and side column come out exactly the same width. */}
        <div className="grid gap-x-6 lg:grid-cols-3 items-start pb-12">
          <div className="min-w-0 lg:col-span-2">

            {/* ── SUBMITTED — the original card layout: details (and checks)
                open on hover on the left, documents always open on the right ── */}
            {activeTab === "submitted" && (
              <SubmittedTab loan={loan} hasCoapp={hasCoapp} kw={kw} stacked={stacked} checks={checks} dups={dups}
                docGroups={docGroups} toViewSlots={toViewSlots} docsHave={docsHave} docsTotal={checklist.length}
                trancheBusy={trancheBusy} downloadTranche={downloadTranche} />
            )}

            {/* ── DOCS SENT — lenders ── */}
            {activeTab === "docs" && (
              <Section title="Lenders" right={canAct ? sendButton(!tDocsSent) : undefined}>
                <LoanLenderStatusBox rows={lenderRows} />
              </Section>
            )}

            {/* ── APPROVED — the approval-details form ── */}
            {activeTab === "approved" && (
              <>
                {approvedRows.length > 1 && (
                  <Section title="Approved lenders">
                    <ul className="divide-y divide-[#f1f5f3] max-w-[640px]">
                      {approvedRows.map((r) => {
                        const d = (r.approval_details ?? null) as ApprovalDetails | null;
                        const finalized = loan.approved_lender === r.lender_key;
                        return (
                          <li key={r.id} className="py-2 flex items-center gap-3 text-[13px]">
                            <span className="flex-1 min-w-0 font-semibold text-[#0f3d2e] truncate">{r.lender_label}</span>
                            <span className="text-[#5a8a76]">{fmtApproval(d?.approved_loan_amount == null ? null : Number(d.approved_loan_amount), true)}</span>
                            {finalized ? (
                              <span className="text-[12px] font-semibold px-2 py-0.5 rounded-[6px] bg-[#e6f6ee] text-[#178a5c]">Finalized</span>
                            ) : canAct ? (
                              <HAction variant="outline" disabled={statusBusy} onClick={() => void finalizeLender(r.lender_key)}>Finalize</HAction>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </Section>
                )}
                {formFor && !aborted && approvalLocked ? (
                  <>
                    <ReviewBar loan={loan} item="approval" onDecided={mergeReview}
                      onEdit={mainAdmin ? () => setApprovalEdit(true) : undefined} />
                    <ApprovalSummary loan={loan} lenderLabel={savedLender?.label ?? formFor.label} docs={docs} />
                  </>
                ) : formFor && !aborted ? (
                  <>
                    {!approvedPlus && canAct && (
                      <div className="flex justify-end gap-2 pt-5">
                        <HAction variant="reject" disabled={statusBusy} onClick={() => setRejectOpen(true)}>Rejected by lender</HAction>
                      </div>
                    )}
                    {approvalFilled && <ReviewBar loan={loan} item="approval" onDecided={mergeReview} />}
                    <LoanApprovalForm
                      key={`${formFor.key}:${formEdit ?? "new"}`}
                      loan={loan}
                      lender={formFor.key}
                      lenderLabel={formFor.label}
                      editMode={formEdit}
                      hasSanctionLetter={hasCat("sanction_letter")}
                      hasDisbursementAdvice={hasCat("disbursement_advice")}
                      onSaved={() => { setFormLender(null); setApprovalEdit(false); setReloadKey((k) => k + 1); }}
                      onCancel={formLender ? () => setFormLender(null) : approvalEdit ? () => setApprovalEdit(false) : undefined}
                    />
                  </>
                ) : (
                  <Section
                    title="Lender decision"
                    right={canAct ? (
                      withDocs.length > 0 ? (
                        <>
                          <HAction variant="primary" icon={I.check} disabled={statusBusy} onClick={approveNow}>Approved by lender</HAction>
                          <HAction variant="reject" disabled={statusBusy} onClick={() => setRejectOpen(true)}>Rejected by lender</HAction>
                        </>
                      ) : sendButton(false)
                    ) : undefined}
                  >
                    <LoanLenderStatusBox rows={lenderRows} />
                  </Section>
                )}
              </>
            )}

            {/* ── 1st / 2nd DISBURSEMENT — that tranche's documents and amount ── */}
            {activeTab === "first" && <LoanDisbursementPanel loan={loan} part="first" onChanged={reloadLoan} />}
            {activeTab === "second" && <LoanDisbursementPanel loan={loan} part="second" onChanged={reloadLoan} />}
          </div>

          {/* ── SIDE — assigned + comments, on every stage ── */}
          <aside className="min-w-0 flex flex-col gap-4 pt-6">
            <Section card icon={I.users} title="Assigned">
              <OwnershipCard
                bare
                module="apps"
                recordId={loan.id}
                createdByUserId={loan.created_by_user_id ?? null}
                assignedToUserId={loan.assigned_to_user_id ?? null}
              />
            </Section>
            <Section card icon={I.lock} title="Comments">
              <CommentsSection
                applicationId={loan.id}
                epcName={applicantName}
                maxListHeight={360}
              />
            </Section>
            {/* Loads on first open (once per visit, again after a change here). */}
            <Section card dropdown icon={I.activity} title="Activity">
              <div className="pt-1">
                <LoanActivityList key={`${loan.status}:${loan.aborted_at ?? ""}:${reloadKey}`} loan={loan} compact />
              </div>
            </Section>
          </aside>
        </div>
      </div>

      <LenderPickerModal
        open={zipPickerOpen}
        onClose={() => setZipPickerOpen(false)}
        epcName={applicantName}
        onConfirm={(lender) => downloadZip(lender)}
      />

      <EmailComposerModal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        endpoint={`/api/admin/loan-app/${loan.id}/send-to-lender`}
        title="Email to lender"
        defaultLender={loan.approved_lender}
        onSent={(lenderKey) => { void sendDocsToLender({ key: lenderKey, label: lenderLabelIn(lenders, lenderKey) }); }}
      />
      <LoanLenderPickerModal
        open={docSentPickerOpen}
        title="Send documents to a lender"
        subtitle={`For ${applicantName}. Pick the lender you're sending the documents to.`}
        options={availableForDocSent}
        allowAdd
        confirmLabel="Mark docs sent"
        tone="blue"
        onClose={() => setDocSentPickerOpen(false)}
        onConfirm={(l) => sendDocsToLender(l)}
      />
      <LoanLenderPickerModal
        open={approveOpen}
        title="Approve application"
        subtitle={`For ${applicantName}. Which lender approved? You'll fill in the approval details next.`}
        options={withDocsOptions}
        confirmLabel="Continue to details"
        tone="green"
        onClose={() => setApproveOpen(false)}
        onConfirm={(l) => approvePickLender(l)}
      />
      <LoanLenderPickerModal
        open={changeLenderOpen}
        title="Change lender"
        subtitle={`For ${applicantName}. Pick the lender to finalize this application with (e.g. one rejected it, another approved). You'll fill in the approval details next.`}
        options={allLenderOptions}
        allowAdd
        confirmLabel="Continue to details"
        tone="green"
        onClose={() => setChangeLenderOpen(false)}
        onConfirm={(l) => { setChangeLenderOpen(false); approvePickLender(l); }}
      />
      <LoanLenderPickerModal
        open={rejectOpen}
        title="Reject application"
        subtitle={`For ${applicantName}. Which lender rejected?`}
        options={withDocsOptions}
        needReason
        needDate
        confirmLabel="Mark rejected"
        tone="red"
        onClose={() => setRejectOpen(false)}
        onConfirm={(l, reason, date) => rejectLenderNow(l, reason, date)}
      />
      {abortOpen && (
        <AbortModal busy={statusBusy} reason={abortReason} onReason={setAbortReason} onClose={() => setAbortOpen(false)}
          onAbort={(r) => { void doAbort(r).then((ok) => { if (ok) { setAbortOpen(false); setAbortReason(""); } }); }} />
      )}
      <DocViewer
        items={viewerItems}
        index={viewerIndex >= 0 ? viewerIndex : null}
        onIndex={(i) => setViewerKey(viewerItems[i]?.key ?? null)}
        onClose={() => setViewerKey(null)}
      />
      <EditLoanDatesModal
        open={datesOpen}
        loan={loan}
        onClose={() => setDatesOpen(false)}
        onSaved={() => { setDatesOpen(false); setReloadKey((k) => k + 1); }}
      />
      <ConfirmDeleteModal
        open={delOpen}
        onClose={() => setDelOpen(false)}
        onDeleted={() => { invalidate("dash.apps"); router.replace("/admin" as any); }}
        endpoint="/api/admin/delete-loan-app"
        body={{ applicationId: loan.id }}
        title="Delete loan application permanently"
        confirmLabel="Delete application permanently"
        message="You’re about to permanently delete this loan application and every document attached to it. This cannot be undone."
        rows={[
          { label: "Loan ID", value: displayId(loan) ?? "—", className: "font-mono font-semibold" },
          { label: "Applicant", value: applicantName || "(no name)", className: "font-semibold" },
          { label: "Mobile", value: loan.borrower_mobile ? `+91 ${loan.borrower_mobile}` : "—" },
        ]}
        deletes={[
          "The loan application row",
          "All uploaded documents (PAN, Aadhaar, e-bill, photos, quotation, etc.)",
          "Storage folder in Google Cloud Storage",
        ]}
      />
    </main>
  );
}
