"use client";

// EPC View — the same layout as the Loan Application View: a header, key
// numbers, the progress bar that IS the tabs (Submitted → Review by CC → Docs
// Sent → Lender approval → Active; click a stage to open it), the stage body on
// the left two columns and Assigned / Comments / Activity on the right.
// For editing, Edit → chat or the form (/admin/epc/[id]).
//
// Colors (brand palette from the approved reference):
//   #178a5c  primary green
//   #185fa5  sky blue accent
//   #0f3d2e  dark green text
//   #5a8a76  muted green text
//   #f0faf5  light green tint (admin-only sections)
//   #dceffb  light blue tint (pills)
//   #cdeadd  green card border
//   #d3e9f7  blue card border
//   #fef0d6  amber pill bg
//   #854f0b  amber pill text

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import { authHeaders, getBusiness, isMainAdmin } from "@/lib/auth";
import { epcReviewPatch, approveEpcReview, epcLocked, invalidatePendingCount, saveEpcLenderState } from "@/lib/review";
import AdminPendingPill from "@/components/AdminPendingPill";
import { getDocumentUrl, deleteDocument, downloadDocument, saveDownload } from "@/lib/storage";
import { BUSINESS_TYPE_LABEL, EPC_STATUS_LABEL, maskAcct, peopleHeading } from "@/lib/epc-labels";
import { logAudit } from "@/lib/auditLog";
import { Period, inPeriod } from "@/lib/period";
import LenderCell, { LenderMap } from "@/components/LenderCell";
import { addLender as addRegistryLender, useLenders } from "@/lib/lenders";
import LenderPickerModal, { LenderKey } from "@/components/LenderPickerModal";
import CommentsSection from "@/components/CommentsSection";
import OwnershipCard from "@/components/OwnershipCard";
import ActivityLog from "@/components/ActivityLog";
import ConfirmDeleteModal from "@/components/ConfirmDeleteModal";
import EpcPasswordEmailModal from "@/components/EpcPasswordEmailModal";
import CustomTemplateCard from "@/components/CustomTemplateCard";
import SubscriptionCard from "@/components/SubscriptionCard";
import EmailComposerModal from "@/components/EmailComposerModal";
import { invalidate } from "@/lib/list-cache";
import { DownloadMenu, KebabMenu } from "@/components/ProfileTabBar";
import { computeEpcHealth, submittedLoans } from "@/lib/epc-score";
import { fmtDate, fmtDateTime, localIsoDate } from "@/lib/dates";
import DateField from "@/components/ui/DateField";
import Modal, { OVERLAY } from "@/components/ui/Modal";
import { notify } from "@/lib/notify";
import { askConfirm } from "@/lib/confirm";
// Shared view chrome — the SAME kit the Loan Application View imports, so the
// two dashboards can't drift apart. EPC-specific pieces live in ./_parts.
import {
  I, KV, formatGstAddress, StepBlock, CopyButton, FieldCol, FillCount, fillOf, fillText, fillTone,
  HAction, ProgressTabs, Section, StatCards,
  type FieldRow, type StageState,
} from "@/components/view/ViewKit";
import { backLabel, returnFor, takeReturn, useStacked } from "@/components/view/hooks";
import { DocumentsBySteps, expectedEpcSlots, missingEpcDocs, roleLabel, type Doc, type Stakeholder } from "./_parts/EpcDocuments";
import { EpcHealthPanel } from "./_parts/EpcHealth";
import LenderLines, { type LenderRow } from "./_parts/LenderLines";
import RejectEpcModal from "./_parts/RejectEpcModal";
import { SERVICE_LABEL, cap, fmtCapacity, fmtTeam, fmtTurnover, type AdminInfo } from "./_parts/format";

export default function AdminEpcViewPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

type Biz = Record<string, any>;
// The progress bar's stages — each one a tab.
type EpcStage = "submitted" | "review" | "docs" | "lender" | "active";

function Inner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  // Back → the Task Manager when it opened this EPC (components/view/hooks), else the console.
  const [returnTo] = useState(() => returnFor(`/admin/epc/${params.id}/`));
  const [biz, setBiz] = useState<Biz | null>(null);
  const [loans, setLoans] = useState<{ status: string; aborted_at: string | null; plant_use_type: string | null; loan_display_id: string | null; sanctioned_amount: number | null; first_disbursement_amount: number | null; second_disbursement_amount: number | null; created_at: string | null; borrower_pan: string | null; borrower_mobile: string | null }[]>([]);
  // EPC Health period filter ("all" = every application this EPC has, ever).
  const [hPeriod, setHPeriod] = useState<Period | "all">("all");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [lender, setLender] = useState<LenderRow[]>([]);
  // The lender registry (lib/lenders) — every lender the portal works with.
  const lenderList = useLenders();
  const [adminInfo, setAdminInfo] = useState<AdminInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [zipPickerOpen, setZipPickerOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  // Marking a lender Approved asks for the date the lender approved.
  const [approveFor, setApproveFor] = useState<string | null>(null);
  const [approveDate, setApproveDate] = useState("");
  const approveTitleId = useId(); // names the approval-date pop-up for screen readers
  const [deleteOpen, setDeleteOpen] = useState(false);
  // The open stage (null = wherever the profile stands now).
  const [tab, setTab] = useState<EpcStage | null>(null);
  // Under xl the Submitted cards stack ABOVE Documents (their details open in place).
  const stacked = useStacked();
  const [pwOpen, setPwOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState<string>("");
  const [rejectOther, setRejectOther] = useState<string>("");
  // Bumped after any comment write to force ActivityLog to re-fetch.
  const [activityRefresh, setActivityRefresh] = useState(0);

  useEffect(() => {
    void (async () => {
      const [{ data: b }, { data: d }, { data: l }, { data: ai }, { data: la }] = await Promise.all([
        supabase().from("epc_business").select("*").eq("id", params.id).maybeSingle(),
        supabase().from("epc_documents").select("id, category, file_name, mime_type, stakeholder_id, metadata").eq("business_id", params.id),
        supabase().from("epc_lender_status").select("lender, docs_given, approved, rejected, docs_given_at, approved_at, rejected_at").eq("business_id", params.id),
        supabase().from("epc_admin_info").select("*").eq("business_id", params.id).maybeSingle(),
        supabase().from("epc_applications").select("status, aborted_at, plant_use_type, loan_display_id, sanctioned_amount, first_disbursement_amount, second_disbursement_amount, created_at, borrower_pan, borrower_mobile").eq("epc_business_id", params.id),
      ]);
      setBiz(b);
      setDocs((d ?? []) as Doc[]);
      setLender((l ?? []) as LenderRow[]);
      setAdminInfo((ai as AdminInfo | null) ?? null);
      setLoans((la ?? []) as typeof loans);
    })();
  }, [params.id]); // a comment only refreshes the Activity log, never the whole profile

  // Bumped whenever the inline CommentsSection writes something — so the
  // Activity log modal (which reads from admin_edit_log) reflects the
  // new comment event next time the admin opens it.
  function onCommentsChanged() {
    setActivityRefresh((n) => n + 1);
  }

  const r3bDocs = useMemo(() => docs.filter((d) => d.category === "gst_r3b"), [docs]);

  // Which EPC Health tab is active (RESI / C&I / Total).
  const [healthTab, setHealthTab] = useState<"res" | "com" | "total">("total");

  // EPC Health + Score — one engine over THIS EPC's own loan applications,
  // scoped to the selected period ("all" = every row). Split RESI / C&I via the
  // CC-RES / CC-COM display-id prefix; the Total tab also carries the portfolio
  // signals (transaction volume, repeat business, installation TAT) + the score.
  const health = useMemo(() => {
    const scoped = hPeriod === "all" ? loans : loans.filter((r) => inPeriod(r.created_at, hPeriod));
    return computeEpcHealth(scoped);
  }, [loans, hPeriod]);
  const r3bTotal = useMemo(
    () => r3bDocs.reduce((s, d) => {
      const v = (d.metadata as { total_taxable_value?: number } | null)?.total_taxable_value;
      return typeof v === "number" && !isNaN(v) ? s + v : s;
    }, 0),
    [r3bDocs],
  );
  const nonR3bDocs = useMemo(() => docs.filter((d) => d.category !== "gst_r3b"), [docs]);
  const stakeholders = ((biz?.stakeholders ?? []) as Stakeholder[]);
  // Approving needs every document the Documents card expects.
  const missingDocs = missingEpcDocs(nonR3bDocs, stakeholders, (biz?.business_type as string | null) ?? null);
  function approveBlocked(): boolean {
    if (!missingDocs.length) return false;
    notify.error(`Upload all documents before approving. Missing: ${missingDocs.join(", ")}.`);
    return true;
  }
  const refs = ((biz?.business_references ?? []) as Array<{ type: "customer" | "supplier"; name: string; mobile: string }>);
  const customers = refs.filter((r) => r.type === "customer");
  const suppliers = refs.filter((r) => r.type === "supplier");
  // "How did you know about us?" (referral_source is stored as a key).
  const REFERRAL_LABELS: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", website: "Website", linkedin: "LinkedIn", friend: "Friend", epc_partner: "EPC Partner", others: "Others" };
  const referral = (() => {
    const src = (biz?.referral_source as string | undefined) || "";
    if (!src) return null;
    const label = REFERRAL_LABELS[src] ?? src;
    const other = (biz?.referral_source_other as string | undefined) || "";
    return src === "others" && other ? `Others — ${other}` : label;
  })();

  // Shape the loaded lender rows into the LenderMap the shared dropdown expects.
  const lenderMap: LenderMap = useMemo(() => {
    const m: LenderMap = {};
    for (const l of lender) {
      m[l.lender] = { docs_given: !!l.docs_given, approved: !!l.approved, rejected: !!(l as { rejected?: boolean }).rejected };
    }
    return m;
  }, [lender]);

  async function openDoc(id: string) {
    const u = await getDocumentUrl(id);
    if (u) window.open(u, "_blank");
  }

  const downloadDoc = downloadDocument;

  // Remove an EPC document (epc_documents row + its GCS object) — immediate.
  async function removeDoc(id: string) {
    const ok = await deleteDocument(id);
    if (!ok) { notify.error("Couldn't remove the document."); return; }
    setDocs((arr) => arr.filter((d) => d.id !== id));
  }

  // Internal status transitions — writes to epc_business.status (admin's
  // internal tracking field) and logs to admin_edit_log. This mirrors the
  // detail page's changeStatus. IMPORTANT: this DOES NOT unlock the EPC's
  // loan application — only a lender "Approved" tick does that.
  // Resolves true once the status is saved (false when blocked or the save failed).
  async function changeStatus(next: "approved" | "on_hold" | "rejected" | "under_review", reason?: string | null): Promise<boolean> {
    if (!biz || statusBusy) return false;
    if (next === "approved" && approveBlocked()) return false;
    setStatusBusy(true);
    try {
      // reviewed_at = the first time an admin acted on this EPC after
      // it was submitted. First-write wins — subsequent status flips
      // keep the original timestamp so the analytics "time to review"
      // metric measures initial admin response, not the latest change.
      // Approving: the team's approval waits for the main admin's check (Pendings).
      const patch: Record<string, unknown> = { status: next, ...(next === "approved" ? epcReviewPatch() : {}) };
      const firstReview = !biz.reviewed_at ? new Date().toISOString() : null;
      if (firstReview) patch.reviewed_at = firstReview;
      // Rejection reason: set it when rejecting, clear it on any other status.
      const nextReason = next === "rejected" ? (reason ?? null) : null;
      patch.rejection_reason = nextReason;

      const { error } = await supabase()
        .from("epc_business")
        .update(patch)
        .eq("id", biz.id);
      if (error) {
        notify.error("Status update failed: " + error.message);
        return false;
      }
      await logAudit(biz.id, "field_edit", "status", biz.status, next);
      setBiz({ ...biz, ...patch, ...(next === "approved" ? {} : { admin_review_status: null }) });
      invalidatePendingCount();
      return true;
    } finally {
      setStatusBusy(false);
    }
  }

  // "Change review": back to Under Review, after a yes.
  async function revertReview() {
    if (await askConfirm("Revert the CC review back to Under Review?")) await changeStatus("under_review");
  }

  // Main admin's check of a profile the team approved (same as on Pendings).
  async function approveAdminCheck() {
    if (!biz || statusBusy) return;
    setStatusBusy(true);
    try {
      const msg = await approveEpcReview(biz.id);
      if (msg) { notify.error("Couldn't approve: " + msg); return; }
      await logAudit(biz.id, "field_edit", "admin_review", "pending", "approved");
      setBiz({ ...biz, admin_review_status: "approved" });
      invalidatePendingCount();
    } finally {
      setStatusBusy(false);
    }
  }

  // Set ONE exclusive lender state (none / docs / approved / rejected) from the
  // profile — same epc_lender_status upsert the main table's Lender status uses.
  // Approved / Rejected are gated behind Docs Sent in the UI below.
  async function setLenderExclusive(lenderKey: string, target: "none" | "docs" | "approved" | "rejected", approvedOn?: string) {
    if (!biz) return;
    if (epcLocked(biz)) { notify.error("This profile is waiting for admin approval."); return; }
    // Gate: docs can't go to a lender until the EPC profile is approved. The main
    // admin can approve it now and continue in one step; a team member's approval
    // goes to the admin's check first, so the lender step waits.
    if ((target === "docs" || target === "approved") && biz.status !== "approved") {
      if (approveBlocked()) return;
      if (!isMainAdmin(getBusiness())) {
        if (await askConfirm("This EPC profile hasn't been approved yet.\n\nApprove it now and send it for admin approval?")) await changeStatus("approved");
        return;
      }
      if (!(await askConfirm("This EPC profile hasn't been approved yet.\n\nApprove it now and continue?"))) return;
      if (!(await changeStatus("approved"))) return; // approval failed: no lender write
    }
    const flags = { docs_given: target === "docs", approved: target === "approved", rejected: target === "rejected" };
    const dbPatch: Record<string, unknown> = { ...flags, rejected_at: target === "rejected" ? new Date().toISOString() : null };
    // The lender's approval date as entered (a date — stored at IST midnight).
    if (target === "approved" && approvedOn) dbPatch.approved_at = `${approvedOn}T00:00:00+05:30`;
    const prev = lender;
    const was = lender.find((x) => x.lender === lenderKey);
    setLender((arr) => [...arr.filter((x) => x.lender !== lenderKey), {
      ...was, lender: lenderKey, ...flags,
      rejected_at: dbPatch.rejected_at as string | null,
      ...(dbPatch.approved_at ? { approved_at: dbPatch.approved_at as string } : {}),
    }]);
    try {
      await saveEpcLenderState(biz.id, lenderKey, dbPatch);
      await logAudit(biz.id, "field_edit", `lender_${lenderKey}`, null, target);
    } catch (e) {
      setLender(prev);
      notify.error("Couldn't save lender state: " + (e as Error).message);
    }
  }

  // Add a lender to the global registry (GLOBAL — appears on every dropdown).
  async function addLender(name: string) {
    if (!name.trim()) return;
    const r = await addRegistryLender(name);
    if (r.error) notify.error(r.error);
    else if (r.existed) notify.error("That lender already exists.");
  }

  async function downloadZip(lender: LenderKey) {
    if (!biz || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/epc/${biz.id}/download-zip?lender=${lender}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await saveDownload(res, `EPC_${biz.id.slice(0, 8)}.zip`);
    } catch (e) {
      notify.error("Download failed: " + (e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  if (!biz) return <div className="p-10 text-center text-cc-muted">Loading…</div>;

  const trade = biz.trade_name || biz.legal_name || biz.contact_name || "—";
  const btLabel = BUSINESS_TYPE_LABEL[biz.business_type ?? ""] ?? biz.business_type;
  const mainAdmin = isMainAdmin(getBusiness());
  const locked = epcLocked(biz);

  // ── Where the profile stands ─────────────────────────────────────────
  const docSlots = expectedEpcSlots(nonR3bDocs, stakeholders, (biz.business_type as string | null) ?? null);
  const docsHave = docSlots.filter((s) => s.doc).length;
  const docsComplete = missingDocs.length === 0;
  const draft = biz.status === "draft";
  const ccApproved = biz.status === "approved";
  const ccRejected = biz.status === "rejected";
  const onHold = biz.status === "on_hold";
  const checkPending = ccApproved && biz.admin_review_status === "pending";
  const reviewDone = ccApproved && !checkPending;
  const lenderLabel = (k: string) => lenderList.find((l) => l.key === k)?.label ?? k;
  const sentRows = lender.filter((l) => l.docs_given || l.approved || l.rejected);
  const approvedRows = lender.filter((l) => l.approved);
  const rejectedRows = lender.filter((l) => l.rejected);
  const allRejected = sentRows.length > 0 && rejectedRows.length === sentRows.length;
  const names = (rows: LenderRow[]) => rows.map((r) => lenderLabel(r.lender)).join(", ");
  const firstAt = (rows: LenderRow[], k: "docs_given_at" | "approved_at") =>
    rows.map((r) => r[k]).filter((v): v is string => !!v).sort()[0] ?? null;
  // Done steps show when: date + time, or the date alone for a lender's
  // approval (a date entered by hand).
  const withWhen = (what: ReactNode, when: string | null | undefined, dateOnly = false) =>
    (when ? <>{what}<br />{dateOnly ? fmtDate(when) : fmtDateTime(when)}</> : what);
  // Submitted applications (drafts left out, aborted / rejected in) — the same count as EPC Health.
  const submittedApps = submittedLoans(loans).length;

  const stages: Array<{ key: EpcStage; label: string; sub?: ReactNode; icon: ReactNode; state: StageState }> = [
    {
      key: "submitted", label: "Submitted", icon: I.send,
      state: docsComplete && !draft ? "done" : "current",
      sub: docsComplete ? (draft ? "Draft" : "Complete") : <><FillCount have={docsHave} total={docSlots.length} /> documents</>,
    },
    {
      key: "review", label: ccRejected ? "Rejected by CC" : "Review by CC", icon: I.circleCheck,
      state: ccRejected ? "failed" : onHold ? "hold" : reviewDone ? "done" : ccApproved || (docsComplete && !draft) ? "current" : "pending",
      // When the main admin approved (admin_reviewed_at); older profiles, approved
      // before that was recorded, fall back to the first review.
      sub: reviewDone ? withWhen("Approved by Manish", biz.admin_reviewed_at ?? biz.reviewed_at ?? null) : checkPending ? "Admin check pending" : ccRejected ? "Rejected" : onHold ? "On hold" : docsComplete && !draft ? "Awaiting review" : "Pending",
    },
    {
      key: "docs", label: "Docs Sent", icon: I.files,
      state: sentRows.length ? "done" : reviewDone ? "current" : "pending",
      sub: sentRows.length ? withWhen(`${sentRows.length} lender${sentRows.length === 1 ? "" : "s"}`, firstAt(sentRows, "docs_given_at")) : reviewDone ? "Ready to send" : "Pending",
    },
    {
      key: "lender", label: allRejected ? "Rejected by lender" : "Lender approval", icon: I.bank,
      state: approvedRows.length ? "done" : allRejected ? "failed" : sentRows.length ? "current" : "pending",
      sub: approvedRows.length ? withWhen(names(approvedRows), firstAt(approvedRows, "approved_at"), true) : allRejected ? names(rejectedRows) : sentRows.length ? "Awaiting decision" : "Pending",
    },
    {
      key: "active", label: "Active", icon: I.activity,
      state: approvedRows.length ? "done" : "pending",
      sub: approvedRows.length ? `${submittedApps} application${submittedApps === 1 ? "" : "s"}` : "Pending",
    },
  ];
  const stageNow: EpcStage = stages.find((s) => s.state !== "done")?.key ?? "active";
  const activeTab: EpcStage = tab ?? stageNow;

  // ── Submitted — every field, per card (optional ones don't count) ──
  const contactRows: FieldRow[] = [
    { k: "POC", v: biz.contact_name },
    { k: "Mobile", v: biz.contact_mobile ? `+91 ${biz.contact_mobile}` : null, copy: biz.contact_mobile },
    { k: "Email", v: biz.contact_email, copy: biz.contact_email },
    { k: "PAN", v: biz.pan_number, copy: biz.pan_number },
    { k: "PM Surya Ghar", v: biz.pm_surya_ghar === "other" ? `Other · ${biz.pm_surya_ghar_other || "—"}` : biz.pm_surya_ghar ? cap(biz.pm_surya_ghar) : null },
    ...(biz.pm_surya_ghar === "yes" ? [{ k: "Surya Ghar installs", v: biz.pm_surya_ghar_capacity }] : []),
  ];
  const businessRows: FieldRow[] = [
    { k: "Trade Name", v: biz.trade_name },
    { k: "GSTIN", v: biz.gstin_number, copy: biz.gstin_number },
    { k: "GST Address", v: formatGstAddress(biz.gst_address), wrap: true },
    { k: "Constitution Type", v: btLabel },
  ];
  const memberRows: FieldRow[][] = stakeholders.map((s) => {
    const sx = s as Record<string, any>;
    return [
      { k: "Name", v: s.name },
      { k: "Father's Name", v: sx.father_name },
      { k: "Mobile No.", v: s.mobile ? `+91 ${s.mobile}` : null, copy: s.mobile },
      { k: "Email ID", v: s.email, copy: s.email },
      { k: "DOB", v: sx.dob },
      { k: "Aadhaar No.", v: sx.aadhaar_number },
      { k: "Address", v: sx.aadhaar_address, wrap: true },
    ];
  });
  const bankRows: FieldRow[] = [
    { k: "Account", v: biz.bank_account_number ? maskAcct(biz.bank_account_number) : null, copy: biz.bank_account_number },
    { k: "IFSC", v: biz.bank_ifsc, copy: biz.bank_ifsc },
    { k: "Bank", v: biz.bank_name },
    { k: "GST username", v: biz.gst_username, copy: biz.gst_username },
  ];
  const referenceRows: FieldRow[] = [
    { k: "How did you know about us?", v: referral, wrap: true },
    { k: "Customers", v: customers.map((c) => c.name).join(" · "), wrap: true, optional: true },
    { k: "Suppliers", v: suppliers.map((s) => s.name).join(" · "), wrap: true, optional: true },
  ];
  const infoRows: FieldRow[] = [
    { k: "Team size", v: fmtTeam(adminInfo) },
    { k: "Resi cap.", v: fmtCapacity(adminInfo?.capacity_residential, adminInfo?.capacity_residential_unit) },
    { k: "Comm cap.", v: fmtCapacity(adminInfo?.capacity_commercial, adminInfo?.capacity_commercial_unit) },
    { k: "Turnover", v: fmtTurnover(adminInfo) },
    { k: "Expectation", v: biz.business_expectation_value != null
        ? `${biz.business_expectation_value}${biz.business_expectation ? " " + cap(biz.business_expectation) : ""}`
        : (biz.business_expectation ? cap(biz.business_expectation) : null) },
  ];

  // ── Lenders ──
  const lenderControl = locked ? <AdminPendingPill /> : !draft ? (
    <LenderCell
      state={lenderMap}
      lenders={lenderList}
      onSet={(l, target) => {
        if (target === "approved") { setApproveDate(localIsoDate(new Date())); setApproveFor(l); }
        else void setLenderExclusive(l, target);
      }}
      onAddLender={addLender}
    />
  ) : null;

  const statusLabel = approvedRows.length ? "Approved by lender"
    : checkPending ? "Admin check pending"
    : ccApproved ? "Approved by Manish"
    : ccRejected ? "Rejected by CC"
    : EPC_STATUS_LABEL[biz.status] ?? biz.status;
  const statusCls = approvedRows.length || reviewDone ? "bg-cc-tint text-cc-green-text border-[#bfe6d5]"
    : ccRejected ? "bg-red-50 text-red-700 border-red-200"
    : "bg-warn-wash text-warn-ink border-[#f3dcb4]";
  const editItems = [
    { label: "Continue in chat", onClick: () => router.push(`/admin/epc/intake?epc=${biz.id}&edit=1`) },
    { label: "Edit in form", onClick: () => router.push(`/admin/epc/${biz.id}`) },
  ];
  const kebabItems = [
    { label: "Download ZIP", icon: I.download, onClick: () => setZipPickerOpen(true) },
    ...(biz.business_type !== "admin" ? [{
      label: "Delete",
      icon: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>),
      onClick: () => setDeleteOpen(true),
      danger: true,
    }] : []),
  ];

  return (
    <main className="min-h-screen bg-white">
      {/* ── HEADER — who it is, one quiet info line · plain buttons ── */}
      <header className="border-b border-cc-rule bg-white/95 backdrop-blur sticky top-0 z-30">
        <div className="w-full px-5 sm:px-8 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3.5 min-w-0">
            <button
              onClick={() => router.push(takeReturn(`/admin/epc/${params.id}/`) ?? "/admin")}
              title={backLabel(returnTo, "Back to console")}
              aria-label={backLabel(returnTo, "Back to console")}
              className="w-9 h-9 -ml-2 rounded-full grid place-items-center text-cc-muted hover:bg-cc-icon-hover hover:text-cc-ink shrink-0"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            </button>
            <div className="w-12 h-12 rounded-full bg-cc-tint text-cc-green grid place-items-center shrink-0">
              {I.building}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <h1 className="text-[22px] font-semibold text-cc-ink truncate leading-tight">{trade}</h1>
                <span className={"shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-semibold border whitespace-nowrap " + statusCls}>{statusLabel}</span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-[13px] text-cc-faint min-w-0">
                {biz.epc_display_id && (
                  <span className="group inline-flex items-center gap-1 font-medium text-cc-blue shrink-0">
                    {biz.epc_display_id}
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex"><CopyButton value={biz.epc_display_id} label="Copy EPC ID" /></span>
                  </span>
                )}
                <span className="truncate">
                  {[btLabel, biz.service_type ? SERVICE_LABEL[biz.service_type] ?? biz.service_type : null].filter(Boolean).join("  ·  ")}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {mainAdmin && biz.business_type !== "admin" && ccApproved && (
              <HAction variant="outline" icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" /></svg>} onClick={() => setPwOpen(true)}>
                Email password
              </HAction>
            )}
            <DownloadMenu label="Edit" icon={I.edit} items={editItems} />
            <KebabMenu items={kebabItems} ghost />
          </div>
        </div>
        {/* Status lines: the CC rejection reason, lenders that said no. */}
        {(ccRejected && biz.rejection_reason) || (rejectedRows.length > 0 && !approvedRows.length) ? (
          <div className="w-full px-5 sm:px-8 pb-3 -mt-1 space-y-0.5">
            {ccRejected && biz.rejection_reason && <div className="text-[12.5px] font-medium text-red-700">Rejection reason: {biz.rejection_reason}</div>}
            {rejectedRows.length > 0 && !approvedRows.length && <div className="text-[12.5px] font-medium text-red-700">Rejected by lender: {names(rejectedRows)}</div>}
          </div>
        ) : null}
      </header>

      <div className="w-full px-5 sm:px-8" style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#0f3d2e" }}>
        {/* ── Key numbers ── */}
        <div className="pt-6 pb-2">
          <StatCards
            items={[
              { label: "Documents", value: fillText(docsHave, docSlots.length), tone: fillTone(docsHave, docSlots.length) },
              { label: "Sent to lenders", value: String(sentRows.length), sub: sentRows.length ? names(sentRows) : undefined, tone: sentRows.length ? "text-cc-blue" : "text-cc-blank" },
              { label: "Approved by lenders", value: String(approvedRows.length), sub: approvedRows.length ? names(approvedRows) : undefined, tone: approvedRows.length ? "text-cc-green" : "text-cc-blank" },
              { label: "Loan applications", value: String(submittedApps), tone: submittedApps ? undefined : "text-cc-blank" },
            ]}
          />
        </div>

        {/* ── PROGRESS BAR = TABS ── */}
        <div className="pt-7 pb-2 border-b border-cc-rule">
          <ProgressTabs items={stages} value={activeTab} onChange={(k) => setTab(k as EpcStage)} />
        </div>

        {/* Three equal columns: the stage body spans two, the side one. */}
        <div className="grid gap-x-6 lg:grid-cols-3 items-start pb-12">
          <div className="min-w-0 lg:col-span-2">

            {/* ── SUBMITTED — details open on hover on the left, documents
                always open on the right ── */}
            {activeTab === "submitted" && (
              <div className="grid gap-x-6 gap-y-4 pt-6 xl:grid-cols-2 items-start">
                <div className="flex flex-col gap-4 min-w-0">
                  <Section card dropdown inline={stacked} icon={I.user} title="Contact" summary={fillOf(contactRows)}>
                    <FieldCol title="Contact" rows={contactRows} />
                  </Section>
                  <Section card dropdown inline={stacked} icon={I.building} title="Business details" summary={fillOf(businessRows)}>
                    <FieldCol title="Business details" rows={businessRows} />
                  </Section>
                  <Section card dropdown inline={stacked} icon={I.users} title={peopleHeading(biz.business_type)} summary={stakeholders.length ? fillOf(...memberRows) : undefined}>
                    {stakeholders.length === 0 ? (
                      <p className="text-[14px] text-cc-empty py-[5px]">No members recorded</p>
                    ) : (
                      <div className="grid gap-x-12 gap-y-6 md:grid-cols-2 xl:grid-cols-1">
                        {stakeholders.map((s, i) => (
                          <FieldCol
                            key={s.id ?? i}
                            title={`${s.designation || roleLabel(biz.business_type)}${stakeholders.length > 1 ? ` ${i + 1}` : ""}`}
                            rows={memberRows[i]}
                          />
                        ))}
                      </div>
                    )}
                  </Section>
                  <Section card dropdown inline={stacked} icon={I.bank} title="Bank details" summary={fillOf(bankRows)}>
                    <FieldCol title="Bank details" rows={bankRows} />
                  </Section>
                  <Section card dropdown inline={stacked} icon={I.star} title="References" summary={fillOf(referenceRows)}>
                    <FieldCol title="References" rows={referenceRows} />
                  </Section>
                  <Section card dropdown inline={stacked} icon={I.lock} title="Business info" summary={fillOf(infoRows)}>
                    <FieldCol title="Business info" rows={infoRows} />
                  </Section>
                </div>

                <div className="flex flex-col gap-4 min-w-0">
                  <Section card white icon={I.files} title="Documents" summary={<FillCount have={docsHave} total={docSlots.length} />}>
                    <div className="space-y-4">
                      <DocumentsBySteps
                        docs={nonR3bDocs}
                        stakeholders={stakeholders}
                        businessType={biz.business_type as string | null}
                        openDoc={openDoc}
                        removeDoc={removeDoc}
                        downloadDoc={downloadDoc}
                        eyeIcon={I.eye}
                      />
                      <StepBlock title="GSTR-3B">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[20px] font-semibold text-cc-ink">₹{r3bTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
                            <div className="text-[12px] text-cc-muted">{r3bDocs.length} file{r3bDocs.length === 1 ? "" : "s"} · Grand total taxable</div>
                          </div>
                          {r3bDocs.length > 0 && (
                            <button
                              type="button"
                              onClick={() => void openDoc(r3bDocs[0].id)}
                              title="View GSTR-3B"
                              aria-label="View GSTR-3B"
                              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-cc-line bg-white text-cc-green text-[14px] font-semibold hover:bg-cc-wash"
                            >
                              {I.eye} View
                            </button>
                          )}
                        </div>
                      </StepBlock>
                    </div>
                  </Section>
                </div>
              </div>
            )}

            {/* ── REVIEW BY CC — approve / reject, the admin's check ── */}
            {activeTab === "review" && (
              <Section
                title="Review by CC"
                right={
                  <>
                    {!ccApproved && !ccRejected && (
                      <>
                        <HAction variant="primary" icon={I.check} disabled={statusBusy || !docsComplete} title={docsComplete ? undefined : "Upload all documents first"} onClick={() => void changeStatus("approved")}>Approved</HAction>
                        <HAction variant="reject" disabled={statusBusy} onClick={() => { setRejectReason(""); setRejectOther(""); setRejectOpen(true); }}>Rejected</HAction>
                      </>
                    )}
                    {checkPending && (mainAdmin
                      ? <HAction variant="primary" disabled={statusBusy} onClick={() => void approveAdminCheck()}>Admin approve</HAction>
                      : <AdminPendingPill />)}
                    {(ccApproved || ccRejected) && biz.business_type !== "admin" && (
                      <HAction variant="outline" disabled={statusBusy} onClick={() => void revertReview()}>Change review</HAction>
                    )}
                  </>
                }
              >
                <div className="max-w-[640px]">
                  <KV k="Status" v={statusLabel} />
                  {reviewDone && <KV k="Approved on" v={fmtDateTime(biz.admin_reviewed_at ?? biz.reviewed_at ?? null)} />}
                  {ccRejected &&<KV k="Rejection reason" v={biz.rejection_reason} wrap valueClass="text-red-700" />}
                  {!docsComplete && <KV k="Missing documents" v={missingDocs.join(", ")} wrap valueClass="text-[#d4900f]" />}
                </div>
              </Section>
            )}

            {/* ── DOCS SENT — every lender, email the documents ── */}
            {activeTab === "docs" && (
              <Section
                title="Lenders"
                right={
                  <>
                    {!locked && !draft && (
                      <HAction variant={sentRows.length ? "outline" : "primary"} icon={I.send} onClick={() => setEmailOpen(true)}>Email to lender</HAction>
                    )}
                    {lenderControl}
                  </>
                }
              >
                <LenderLines keys={lenderList.map((l) => l.key)} lender={lender} lenderLabel={lenderLabel} />
              </Section>
            )}

            {/* ── LENDER APPROVAL — the lenders that have the documents ── */}
            {activeTab === "lender" && (
              <Section title="Lender decision" right={lenderControl}>
                {sentRows.length
                  ? <LenderLines keys={sentRows.map((r) => r.lender)} lender={lender} lenderLabel={lenderLabel} />
                  : <p className="text-[14px] text-cc-empty py-1">Pending</p>}
              </Section>
            )}

            {/* ── ACTIVE — EPC Health + Score over this EPC's own applications ── */}
            {activeTab === "active" && (
              <EpcHealthPanel health={health} hPeriod={hPeriod} setHPeriod={setHPeriod} healthTab={healthTab} setHealthTab={setHealthTab} />
            )}
          </div>

          {/* ── SIDE — assigned, comments, activity, on every stage ── */}
          <aside className="min-w-0 flex flex-col gap-4 pt-6">
            <Section card icon={I.users} title="Assigned">
              <OwnershipCard
                bare
                module="epcs"
                recordId={biz.id}
                createdByUserId={biz.created_by_user_id ?? null}
                assignedToUserId={biz.assigned_to_user_id ?? null}
              />
            </Section>
            {/* The EPC's custom quotation template (0122) — reads when opened. */}
            {biz.business_type !== "admin" && (
              <Section card dropdown icon={I.files} title="Custom quotation">
                <CustomTemplateCard businessId={biz.id} />
              </Section>
            )}
            {/* CC's switches for this EPC (0128 / 0133): the new partner portal + the paid features. */}
            {biz.business_type !== "admin" && (
              <Section card dropdown icon={I.lock} title="Subscription">
                <SubscriptionCard businessId={biz.id} />
              </Section>
            )}
            <Section card icon={I.lock} title="Comments">
              <CommentsSection
                businessId={biz.id}
                epcName={trade}
                onChanged={onCommentsChanged}
                maxListHeight={360}
              />
            </Section>
            {/* Loads on first open (once per visit, again after a comment). */}
            <Section card dropdown icon={I.activity} title="Activity">
              <div className="pt-1">
                <ActivityLog businessId={biz.id} refreshKey={activityRefresh} />
              </div>
            </Section>
          </aside>
        </div>
      </div>

      <EpcPasswordEmailModal
        open={pwOpen}
        epc={{ id: biz.id, tradeName: biz.trade_name || biz.legal_name || biz.contact_name || "EPC", contactName: biz.contact_name, mobile: biz.contact_mobile, email: biz.contact_email }}
        onClose={() => setPwOpen(false)}
      />
      {/* Lender approved — the date the lender approved. */}
      {approveFor && (
        <Modal onClose={() => setApproveFor(null)} overlayClassName={OVERLAY.grid} className="w-full max-w-sm bg-white rounded-xl shadow-lg p-6 space-y-4" aria-labelledby={approveTitleId}>
          <h3 id={approveTitleId} className="text-[17px] font-semibold text-cc-ink">Approved by {lenderLabel(approveFor)}</h3>
          <label className="block">
            <span className="block mb-1 text-[12.5px] text-cc-muted">Date of approval</span>
            <DateField value={approveDate} onChange={setApproveDate} max={localIsoDate(new Date())}
              className="border border-line rounded-input px-3 py-2 text-[14px] focus:outline-none focus:border-cc-green" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setApproveFor(null)} className="px-4 py-2 rounded-[8px] border border-line text-[13px] text-text-mid hover:bg-bg-soft">Cancel</button>
            <button type="button" disabled={!approveDate}
              onClick={() => { const l = approveFor; setApproveFor(null); void setLenderExclusive(l, "approved", approveDate); }}
              className="px-4 py-2 rounded-[8px] bg-cc-green text-white text-[13px] font-semibold hover:bg-cc-green-hover disabled:opacity-50">
              Save
            </button>
          </div>
        </Modal>
      )}
      <EmailComposerModal
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        endpoint={`/api/admin/epc/${biz.id}/send-to-lender`}
        title="Send EPC to lender"
      />
      <LenderPickerModal
        open={zipPickerOpen}
        onClose={() => setZipPickerOpen(false)}
        epcName={trade}
        onConfirm={(lender) => downloadZip(lender)}
      />
      <ConfirmDeleteModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          setDeleteOpen(false);
          invalidate("dash.epcs");
          router.replace("/admin"); // replace: browser Back never reopens the deleted profile
        }}
        endpoint="/api/admin/delete-epc"
        body={{ businessId: biz.id }}
        title="Delete profile permanently"
        confirmLabel="Delete profile permanently"
        message="You’re about to permanently delete this EPC and everything attached to it. This cannot be undone."
        rows={[
          { label: "Display ID", value: biz.epc_display_id ?? "—", className: "font-mono font-semibold" },
          { label: "Name", value: biz.contact_name || "(no name)", className: "font-semibold" },
          { label: "Mobile", value: `+91 ${biz.contact_mobile || "—"}` },
        ]}
        deletes={[
          "The EPC business row",
          "All uploaded documents (business, stakeholders, cheque, GST R3B, office photos)",
          "All loan applications and their attached documents",
          "All lender status ticks (Credit Fair / Aerem / Solfin)",
          "All admin comments and activity-log entries",
          "Storage folder in Google Cloud Storage",
        ]}
      />
      {/* Reject-reason picker — choose a reason (or type one) before rejecting. */}
      {rejectOpen && (
        <RejectEpcModal busy={statusBusy} reason={rejectReason} onReason={setRejectReason} other={rejectOther} onOther={setRejectOther}
          onClose={() => setRejectOpen(false)}
          onReject={(reason) => { void changeStatus("rejected", reason).then((ok) => { if (ok) setRejectOpen(false); }); }} />
      )}
    </main>
  );
}
