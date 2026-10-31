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

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import { getToken, getBusiness, isMainAdmin } from "@/lib/auth";
import { epcReviewPatch, approveEpcReview, epcLocked, invalidatePendingCount, saveEpcLenderState } from "@/lib/review";
import AdminPendingPill from "@/components/AdminPendingPill";
import { toast } from "sonner";
import { getDocumentUrl, deleteDocument } from "@/lib/storage";
import { logAudit } from "@/lib/auditLog";
import { Period, inPeriod } from "@/lib/period";
import LenderCell, { LenderMap } from "@/components/LenderCell";
import { addLender as addRegistryLender, useLenders } from "@/lib/lenders";
import LenderPickerModal, { LenderKey } from "@/components/LenderPickerModal";
import CommentsSection from "@/components/CommentsSection";
import OwnershipCard from "@/components/OwnershipCard";
import ActivityLog from "@/components/ActivityLog";
import DeleteEpcModal from "@/components/DeleteEpcModal";
import EpcPasswordEmailModal from "@/components/EpcPasswordEmailModal";
import { epcLoginPassword } from "@/lib/passwords";
import EmailComposerModal from "@/components/EmailComposerModal";
import { invalidate } from "@/lib/list-cache";
import { DownloadMenu, KebabMenu } from "@/components/ProfileTabBar";
import { computeEpcHealth, scoreTone, type TatBands, type HealthBucket } from "@/lib/epc-score";
import { fmtDate, fmtDateTime, localIsoDate } from "@/lib/dates";
import DateField from "@/components/ui/DateField";
// Shared view chrome — the SAME kit the Loan Application View imports, so the
// two dashboards can't drift apart. EPC-specific pieces stay in this file.
import {
  I, StatusBtn, KV, formatGstAddress, StepBlock, DocGrid, CopyButton, FieldCol, FillCount, fillOf, fillText, fillTone,
  HAction, ProgressTabs, Section, StatCards,
  type FieldRow, type StageState, type ViewDocSlot,
} from "@/components/view/ViewKit";

export default function AdminEpcViewPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

type Biz = Record<string, any>;
type Doc = {
  id: string;
  category: string;
  file_name: string | null;
  mime_type: string | null;
  stakeholder_id: string | null;
  metadata: Record<string, unknown> | null;
};
type LenderRow = {
  lender: string; docs_given: boolean; approved: boolean; rejected?: boolean;
  docs_given_at?: string | null; approved_at?: string | null; rejected_at?: string | null;
};
// The progress bar's stages — each one a tab.
type EpcStage = "submitted" | "review" | "docs" | "lender" | "active";
type AdminInfo = {
  team_size: string | null;
  team_technical: number | null;
  team_non_technical: number | null;
  capacity_residential: number | null;
  capacity_residential_unit: "KW" | "MW" | null;
  capacity_commercial: number | null;
  capacity_commercial_unit: "KW" | "MW" | null;
  turnover_last_fy: string | null;
  turnover_lakhs: number | null;
};

const BUSINESS_TYPE_LABEL: Record<string, string> = {
  proprietorship: "Proprietorship",
  pvt_ltd:        "Private Limited",
  partnership:    "Partnership",
  llp:            "LLP",
};

function peopleHeading(bt: string | null | undefined): string {
  switch (bt) {
    case "proprietorship": return "Proprietor details";
    case "pvt_ltd":        return "Director details";
    case "partnership":
    case "llp":            return "Partner details";
    default:               return "Stakeholder details";
  }
}

function roleLabel(bt: string | null | undefined): string {
  switch (bt) {
    case "proprietorship": return "Proprietor";
    case "pvt_ltd":        return "Director";
    case "partnership":
    case "llp":            return "Partner";
    default:               return "Stakeholder";
  }
}

function DOC_LABEL(cat: string): string {
  const M: Record<string, string> = {
    pan_business: "PAN card",
    gstin: "GST reg.",
    extra_doc: "Extra doc",
    admin_extra: "Extra document",
    cancelled_cheque: "Cheque",
    bank_statement: "Bank statement",
    stakeholder_pan: "Member PAN",
    stakeholder_aadhaar: "Aadhaar (legacy)",
    stakeholder_aadhaar_front: "Aadhaar F",
    stakeholder_aadhaar_back: "Aadhaar B",
    office_exterior: "Office ext",
    office_interior: "Office int",
    office_selfie: "Selfie",
    gst_r3b: "GSTR-3B",
  };
  return M[cat] ?? cat;
}

function maskAcct(a: string | null | undefined): string {
  if (!a) return "—";
  if (a.length <= 4) return "•".repeat(6) + a;
  return "•".repeat(Math.max(6, a.length - 4)) + a.slice(-4);
}

function maskMobile(m: string | null | undefined): string {
  if (!m) return "—";
  return m.length === 10 ? "•••••" + m.slice(5) : m;
}

// Reasons offered when an admin rejects an EPC (last option = free text).
const EPC_REJECT_REASONS = [
  "Incomplete documents",
  "Poor / unreadable document quality",
  "Invalid or mismatched GST details",
  "Ineligible business / outside service area",
  "Duplicate registration",
  "Failed verification",
  "Unresponsive / no follow-up",
  "Other",
];

function Inner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
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
  const [serviceBusy, setServiceBusy] = useState(false);
  const [zipPickerOpen, setZipPickerOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  // Marking a lender Approved asks for the date the lender approved.
  const [approveFor, setApproveFor] = useState<string | null>(null);
  const [approveDate, setApproveDate] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  // The open stage (null = wherever the profile stands now).
  const [tab, setTab] = useState<EpcStage | null>(null);
  // Under xl the Submitted cards stack ABOVE Documents, so their details open
  // in place (pushing Documents down) instead of floating over it.
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1279px)");
    const on = () => setStacked(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
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
    toast.error(`Upload all documents before approving. Missing: ${missingDocs.join(", ")}.`);
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

  // Save the document (server signs with Content-Disposition: attachment).
  async function downloadDoc(id: string) {
    const u = await getDocumentUrl(id, { download: true });
    if (!u) return;
    const a = document.createElement("a");
    a.href = u;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Remove an EPC document (epc_documents row + its GCS object) — immediate.
  async function removeDoc(id: string) {
    const ok = await deleteDocument(id);
    if (!ok) { alert("Couldn't remove the document."); return; }
    setDocs((arr) => arr.filter((d) => d.id !== id));
  }

  // Internal status transitions — writes to epc_business.status (admin's
  // internal tracking field) and logs to admin_edit_log. This mirrors the
  // detail page's changeStatus. IMPORTANT: this DOES NOT unlock the EPC's
  // loan application — only a lender "Approved" tick does that.
  async function changeStatus(next: "approved" | "on_hold" | "rejected" | "under_review", reason?: string | null) {
    if (!biz || statusBusy) return;
    if (next === "approved" && approveBlocked()) return;
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
        alert("Status update failed: " + error.message);
        return;
      }
      await logAudit(biz.id, "field_edit", "status", biz.status, next);
      setBiz({ ...biz, ...patch, ...(next === "approved" ? {} : { admin_review_status: null }) });
      invalidatePendingCount();
    } finally {
      setStatusBusy(false);
    }
  }

  // Main admin's check of a profile the team approved (same as on Pendings).
  async function approveAdminCheck() {
    if (!biz || statusBusy) return;
    setStatusBusy(true);
    try {
      const msg = await approveEpcReview(biz.id);
      if (msg) { alert("Couldn't approve: " + msg); return; }
      await logAudit(biz.id, "field_edit", "admin_review", "pending", "approved");
      setBiz({ ...biz, admin_review_status: "approved" });
      invalidatePendingCount();
    } finally {
      setStatusBusy(false);
    }
  }

  // Admin picks the EPC's service. Insurance unlocks purely from this;
  // loan still additionally needs a lender "Approved" tick.
  async function setService(next: "loans" | "insurance" | "both") {
    if (!biz || serviceBusy) return;
    setServiceBusy(true);
    try {
      const { error } = await supabase()
        .from("epc_business")
        .update({ service_type: next })
        .eq("id", biz.id);
      if (error) { alert("Service update failed: " + error.message); return; }
      await logAudit(biz.id, "field_edit", "service_type", biz.service_type ?? null, next);
      setBiz({ ...biz, service_type: next });
    } finally {
      setServiceBusy(false);
    }
  }

  // Set ONE exclusive lender state (none / docs / approved / rejected) from the
  // profile — same epc_lender_status upsert the main table's Lender status uses.
  // Approved / Rejected are gated behind Docs Sent in the UI below.
  async function setLenderExclusive(lenderKey: string, target: "none" | "docs" | "approved" | "rejected", approvedOn?: string) {
    if (!biz) return;
    if (epcLocked(biz)) { alert("This profile is waiting for admin approval."); return; }
    // Gate: docs can't go to a lender until the EPC profile is approved. The main
    // admin can approve it now and continue in one step; a team member's approval
    // goes to the admin's check first, so the lender step waits.
    if ((target === "docs" || target === "approved") && biz.status !== "approved") {
      if (approveBlocked()) return;
      if (!isMainAdmin(getBusiness())) {
        if (window.confirm("This EPC profile hasn't been approved yet.\n\nApprove it now and send it for admin approval?")) await changeStatus("approved");
        return;
      }
      if (!window.confirm("This EPC profile hasn't been approved yet.\n\nApprove it now and continue?")) return;
      await changeStatus("approved");
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
      alert("Couldn't save lender state: " + (e as Error).message);
    }
  }

  // Add a lender to the global registry (GLOBAL — appears on every dropdown).
  async function addLender(name: string) {
    if (!name.trim()) return;
    const r = await addRegistryLender(name);
    if (r.error) alert(r.error);
    else if (r.existed) alert("That lender already exists.");
  }

  async function downloadZip(lender: LenderKey) {
    if (!biz || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/epc/${biz.id}/download-zip?lender=${lender}`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const cd = res.headers.get("content-disposition") || "";
      const m = /filename="?([^"]+)"?/.exec(cd);
      const a = document.createElement("a");
      a.href = url;
      a.download = m?.[1] || `EPC_${biz.id.slice(0, 8)}.zip`;
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

  if (!biz) return <div className="p-10 text-center text-[#5a8a76]">Loading…</div>;

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
  const liveApps = loans.filter((l) => !l.aborted_at).length;

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
      sub: approvedRows.length ? `${liveApps} application${liveApps === 1 ? "" : "s"}` : "Pending",
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

  // ── Lenders — one row each: name, when, state ──
  const lenderStateOf = (key: string) => {
    const l = lender.find((x) => x.lender === key);
    return l ? (l.rejected ? "rejected" : l.approved ? "approved" : l.docs_given ? "docs" : "none") : "none";
  };
  const lenderLines = (keys: string[]) => (
    <ul className="divide-y divide-[#f1f5f3] max-w-[640px]">
      {keys.map((key) => {
        const l = lender.find((x) => x.lender === key);
        const when = l?.approved ? (l.approved_at ? fmtDate(l.approved_at) : null)
          : l?.rejected ? (l.rejected_at ? fmtDateTime(l.rejected_at) : null)
          : l?.docs_given && l.docs_given_at ? fmtDateTime(l.docs_given_at) : null;
        return (
          <li key={key} className="py-2.5 flex items-center gap-3 text-[14px]">
            <span className="flex-1 min-w-0 font-semibold text-[#0f3d2e] truncate">{lenderLabel(key)}</span>
            {when && <span className="text-[12px] text-[#7a958a] whitespace-nowrap">{when}</span>}
            <LenderStatePill state={lenderStateOf(key)} />
          </li>
        );
      })}
    </ul>
  );
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
    : INTERNAL_STATUS_LABEL[biz.status] ?? biz.status;
  const statusCls = approvedRows.length || reviewDone ? "bg-[#e6f6ee] text-[#0f7a52] border-[#bfe6d5]"
    : ccRejected ? "bg-red-50 text-red-700 border-red-200"
    : "bg-[#fef8ee] text-[#854f0b] border-[#f3dcb4]";
  const editItems = [
    { label: "Continue in chat", onClick: () => router.push(`/admin/epc/intake?epc=${biz.id}&edit=1` as any) },
    { label: "Edit in form", onClick: () => router.push(`/admin/epc/${biz.id}` as any) },
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
      <header className="border-b border-[#eef3f1] bg-white/95 backdrop-blur sticky top-0 z-30">
        <div className="w-full px-5 sm:px-8 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3.5 min-w-0">
            <button
              onClick={() => router.push("/admin")}
              title="Back to console"
              aria-label="Back to console"
              className="w-9 h-9 -ml-2 rounded-full grid place-items-center text-[#5a8a76] hover:bg-[#eef6f1] hover:text-[#0f3d2e] shrink-0"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            </button>
            <div className="w-12 h-12 rounded-full bg-[#e6f6ee] text-[#178a5c] grid place-items-center shrink-0">
              {I.building}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <h1 className="text-[22px] font-semibold text-[#0f3d2e] truncate leading-tight">{trade}</h1>
                <span className={"shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-semibold border whitespace-nowrap " + statusCls}>{statusLabel}</span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-[13px] text-[#7a958a] min-w-0">
                {biz.epc_display_id && (
                  <span className="group inline-flex items-center gap-1 font-medium text-[#185fa5] shrink-0">
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
              { label: "Sent to lenders", value: String(sentRows.length), sub: sentRows.length ? names(sentRows) : undefined, tone: sentRows.length ? "text-[#185fa5]" : "text-[#c3cbc7]" },
              { label: "Approved by lenders", value: String(approvedRows.length), sub: approvedRows.length ? names(approvedRows) : undefined, tone: approvedRows.length ? "text-[#178a5c]" : "text-[#c3cbc7]" },
              { label: "Loan applications", value: String(liveApps), tone: liveApps ? undefined : "text-[#c3cbc7]" },
            ]}
          />
        </div>

        {/* ── PROGRESS BAR = TABS ── */}
        <div className="pt-7 pb-2 border-b border-[#eef3f1]">
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
                    <FieldCol title="Contact" rows={contactRows}>
                      {mainAdmin && biz.business_type !== "admin" && <PasswordKV key={String(pwOpen)} businessId={biz.id} />}
                    </FieldCol>
                  </Section>
                  <Section card dropdown inline={stacked} icon={I.building} title="Business details" summary={fillOf(businessRows)}>
                    <FieldCol title="Business details" rows={businessRows} />
                  </Section>
                  <Section card dropdown inline={stacked} icon={I.users} title={peopleHeading(biz.business_type)} summary={stakeholders.length ? fillOf(...memberRows) : undefined}>
                    {stakeholders.length === 0 ? (
                      <p className="text-[14px] text-[#9aa5a0] py-[5px]">No members recorded</p>
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
                            <div className="text-[20px] font-semibold text-[#0f3d2e]">₹{r3bTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
                            <div className="text-[12px] text-[#5a8a76]">{r3bDocs.length} file{r3bDocs.length === 1 ? "" : "s"} · Grand total taxable</div>
                          </div>
                          {r3bDocs.length > 0 && (
                            <button
                              type="button"
                              onClick={() => void openDoc(r3bDocs[0].id)}
                              title="View GSTR-3B"
                              aria-label="View GSTR-3B"
                              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#cdeadd] bg-white text-[#178a5c] text-[14px] font-semibold hover:bg-[#f0faf5]"
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
                      <HAction variant="outline" disabled={statusBusy} onClick={() => { if (window.confirm("Revert the CC review back to Under Review?")) void changeStatus("under_review"); }}>Change review</HAction>
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
                {lenderLines(lenderList.map((l) => l.key))}
              </Section>
            )}

            {/* ── LENDER APPROVAL — the lenders that have the documents ── */}
            {activeTab === "lender" && (
              <Section title="Lender decision" right={lenderControl}>
                {sentRows.length
                  ? lenderLines(sentRows.map((r) => r.lender))
                  : <p className="text-[14px] text-[#9aa5a0] py-1">Pending</p>}
              </Section>
            )}

            {/* ── ACTIVE — EPC Health + Score over this EPC's own applications ── */}
            {activeTab === "active" && (
              <div className="pt-6">
                <div className="rounded-[14px] border border-[#cdeadd] bg-[#f4fbf7] p-5 sm:p-6">
                  {/* Header — title (left) · EPC score + period (right). */}
                  <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
                    <div className="text-[20px] font-bold text-[#0f3d2e] leading-tight">EPC Health</div>
                    <div className="flex items-center gap-2.5 flex-wrap justify-end">
                      {health && <HeaderScore score={health.score} />}
                      <select
                        value={hPeriod}
                        onChange={(e) => setHPeriod(e.target.value as Period | "all")}
                        className="rounded-input border border-[#cdeadd] bg-white px-3 py-2 text-[13px] font-medium text-[#0f3d2e] outline-none focus:border-[#178a5c] cursor-pointer shrink-0"
                      >
                        <option value="all">All time</option>
                        <option value="today">Today</option>
                        <option value="week">This Week</option>
                        <option value="month">This Month</option>
                        <option value="quarter">This Quarter</option>
                        <option value="year">This Year</option>
                      </select>
                    </div>
                  </div>

                  {!health ? (
                    <div className="rounded-[12px] border border-[#e0f0e8] bg-white p-6 text-center text-[14px] text-[#5a8a76]">
                      No applications in this period yet.
                    </div>
                  ) : (() => {
                    const TABS = [
                      { key: "res" as const, label: "RESI" },
                      { key: "com" as const, label: "C&I" },
                      { key: "total" as const, label: "Total" },
                    ];
                    const b = health[healthTab];
                    return (
                      <>
                        {/* Segment tabs */}
                        <div className="inline-flex rounded-[10px] border border-[#cdeadd] overflow-hidden bg-white mb-3">
                          {TABS.map((t) => (
                            <button
                              key={t.key}
                              type="button"
                              onClick={() => setHealthTab(t.key)}
                              className={
                                "px-4 py-1.5 text-[13px] font-semibold border-r border-[#cdeadd] last:border-r-0 transition-colors " +
                                (healthTab === t.key ? "bg-[#178a5c] text-white" : "text-[#0f3d2e] bg-white hover:bg-[#f0faf5]")
                              }
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>

                        {/* Total tab → paired metrics (left) + portfolio signals (right
                            column) + Installation TAT below. Other tabs: metrics full-width. */}
                        {healthTab === "total" ? (
                          <>
                            <div className="grid gap-3 lg:grid-cols-3 items-stretch">
                              <div className="lg:col-span-2"><MetricsCard b={b} /></div>
                              <div className="flex flex-col gap-3">
                                <MiniStat className="flex-1" label="Transaction volume" value={numFmt(health.volume)} />
                                <MiniStat className="flex-1" label="Repeat customers" value={numFmt(health.repeat)} />
                              </div>
                            </div>
                            <TatCard tat={health.tat} className="mt-3" />
                          </>
                        ) : (
                          <MetricsCard b={b} />
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
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
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center px-4" onClick={() => setApproveFor(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-white rounded-xl shadow-lg p-6 space-y-4">
            <h3 className="text-[17px] font-semibold text-[#0f3d2e]">Approved by {lenderLabel(approveFor)}</h3>
            <label className="block">
              <span className="block mb-1 text-[12.5px] text-[#5a8a76]">Date of approval</span>
              <DateField value={approveDate} onChange={setApproveDate} max={localIsoDate(new Date())}
                className="border border-line rounded-input px-3 py-2 text-[14px] focus:outline-none focus:border-[#178a5c]" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setApproveFor(null)} className="px-4 py-2 rounded-[8px] border border-line text-[13px] text-text-mid hover:bg-bg-soft">Cancel</button>
              <button type="button" disabled={!approveDate}
                onClick={() => { const l = approveFor; setApproveFor(null); void setLenderExclusive(l, "approved", approveDate); }}
                className="px-4 py-2 rounded-[8px] bg-[#178a5c] text-white text-[13px] font-semibold hover:bg-[#12734c] disabled:opacity-50">
                Save
              </button>
            </div>
          </div>
        </div>
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
      <DeleteEpcModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          setDeleteOpen(false);
          invalidate("dash.epcs");
          router.push("/admin");
        }}
        businessId={biz.id}
        displayId={biz.epc_display_id ?? null}
        contactName={biz.contact_name ?? null}
        contactMobile={biz.contact_mobile ?? null}
      />
      {/* Reject-reason picker — choose a reason (or type one) before rejecting. */}
      {rejectOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={statusBusy ? undefined : () => setRejectOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-white rounded-[12px] shadow-lg p-5">
            <div className="flex items-start justify-between gap-2 mb-3">
              <h3 className="text-[17px] font-bold text-[#0f3d2e]">Reject this EPC</h3>
              <button type="button" onClick={() => setRejectOpen(false)} className="text-[18px] text-text-muted hover:text-text leading-none p-1">✕</button>
            </div>
            <label className="block text-[13px] font-medium text-text-mid">Reason for rejection
              <select value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                className="mt-1 w-full rounded-input border border-line bg-white px-3 py-2.5 text-[14px] outline-none focus:border-blue">
                <option value="">Select a reason…</option>
                {EPC_REJECT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            {rejectReason === "Other" && (
              <textarea value={rejectOther} onChange={(e) => setRejectOther(e.target.value)} rows={3} autoFocus placeholder="Type the reason…"
                className="mt-2 w-full rounded-input border border-line px-3 py-2 text-[13px] outline-none focus:border-blue resize-none" />
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setRejectOpen(false)} disabled={statusBusy} className="px-4 py-2 rounded-lg border border-line text-[13px] text-text-mid disabled:opacity-60">Cancel</button>
              <button type="button" disabled={statusBusy || !rejectReason || (rejectReason === "Other" && !rejectOther.trim())}
                onClick={() => { const reason = rejectReason === "Other" ? rejectOther.trim() : rejectReason; void changeStatus("rejected", reason).then(() => setRejectOpen(false)); }}
                className="px-5 py-2 rounded-lg bg-red-600 text-white text-[13px] font-semibold hover:bg-red-700 disabled:opacity-60">{statusBusy ? "Rejecting…" : "Reject EPC"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ── Reusable pieces ─────────────────────────────────────────────────

// Service band — same shape as the internal-status band, but green (brand)
// since this is a positive, EPC-affecting choice. Sets epc_business.service_type.
const SERVICE_LABEL: Record<string, string> = {
  loans:     "Loan",
  insurance: "Insurance",
  both:      "Loan and Insurance",
};

function ServiceBand({
  current, busy, onChange,
}: {
  current: "loans" | "insurance" | "both" | null;
  busy: boolean;
  onChange: (next: "loans" | "insurance" | "both") => void;
}) {
  const badge = current ? SERVICE_LABEL[current] : null;
  const btn = (val: "loans" | "insurance" | "both", label: string) => {
    const active = current === val;
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => onChange(val)}
        className={[
          "text-[13px] font-semibold px-3.5 py-1.5 rounded-md border transition-colors disabled:opacity-60",
          active
            ? "bg-[#178a5c] text-white border-[#178a5c]"
            : "bg-white text-[#178a5c] border-[#cdeadd] hover:bg-[#f0faf5]",
        ].join(" ")}
      >
        {label}
      </button>
    );
  };
  return (
    <div className="rounded-[12px] border border-[#cdeadd] bg-[#f0faf5] p-4 sm:p-5 mb-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-[#5a8a76] uppercase tracking-wider mb-1">
            Service <span className="normal-case font-normal text-[#8ab3a1]">· admin only</span>
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[18px] font-semibold text-[#0f3d2e]">{badge ?? "Not set"}</span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {btn("loans", "Only Loans")}
          {btn("insurance", "Only Insurance")}
          {btn("both", "Loan and Insurance")}
        </div>
      </div>
    </div>
  );
}

const INTERNAL_STATUS_LABEL: Record<string, string> = {
  draft:        "Draft",
  under_review: "Under review",
  approved:     "Approved by Manish",
  on_hold:      "On hold",
  rejected:     "Rejected",
};

function InternalStatusBand({
  current, busy, onChange,
}: {
  current: string;
  busy: boolean;
  onChange: (next: "approved" | "on_hold" | "rejected" | "under_review") => void;
}) {
  // Draft: nothing to change yet (EPC hasn't submitted).
  const label = INTERNAL_STATUS_LABEL[current] ?? current;
  return (
    <div className="rounded-[12px] border border-slate-300 bg-slate-50 p-4 sm:p-5 mb-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
            Internal status <span className="normal-case font-normal text-slate-400">· admin only</span>
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[18px] font-semibold text-slate-800">{label}</span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {/* Draft: admin can still act — internal status is admin's
              bookkeeping, not gated on EPC submission. Show the same
              action buttons as under_review, plus a small hint. */}
          {current === "draft" && (
            <>
              <span className="text-[12px] text-slate-500 italic self-center">
                EPC hasn&rsquo;t submitted yet
              </span>
              <StatusBtn kind="approve" busy={busy} onClick={() => onChange("approved")}>Approve</StatusBtn>
              <StatusBtn kind="neutral" busy={busy} onClick={() => onChange("on_hold")}>On hold</StatusBtn>
              <StatusBtn kind="danger" busy={busy} onClick={() => onChange("rejected")}>Reject</StatusBtn>
              <StatusBtn kind="neutral" busy={busy} onClick={() => onChange("under_review")}>Mark under review</StatusBtn>
            </>
          )}
          {current === "under_review" && (
            <>
              <StatusBtn kind="approve" busy={busy} onClick={() => onChange("approved")}>Approve</StatusBtn>
              <StatusBtn kind="neutral" busy={busy} onClick={() => onChange("on_hold")}>On hold</StatusBtn>
              <StatusBtn kind="danger" busy={busy} onClick={() => onChange("rejected")}>Reject</StatusBtn>
            </>
          )}
          {current === "on_hold" && (
            <>
              <StatusBtn kind="approve" busy={busy} onClick={() => onChange("approved")}>Approve</StatusBtn>
              <StatusBtn kind="neutral" busy={busy} onClick={() => onChange("under_review")}>Back to review</StatusBtn>
              <StatusBtn kind="danger" busy={busy} onClick={() => onChange("rejected")}>Reject</StatusBtn>
            </>
          )}
          {current === "rejected" && (
            <StatusBtn kind="neutral" busy={busy} onClick={() => onChange("under_review")}>Re-open</StatusBtn>
          )}
          {current === "approved" && (
            <StatusBtn kind="neutral" busy={busy} onClick={() => onChange("under_review")}>Move back to review</StatusBtn>
          )}
        </div>
      </div>
    </div>
  );
}

function LenderStatePill({ state }: { state: "approved" | "docs" | "none" | "rejected" }) {
  if (state === "rejected") {
    return <span className="text-[13px] text-[#dc2626] font-semibold inline-flex items-center gap-1.5">
      <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#dc2626]" /> rejected
    </span>;
  }
  if (state === "approved") {
    return <span className="text-[13px] text-[#178a5c] font-semibold inline-flex items-center gap-1.5">
      <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#178a5c]" /> approved
    </span>;
  }
  if (state === "docs") {
    return <span className="text-[13px] text-[#854f0b] font-medium inline-flex items-center gap-1.5">
      <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#ef9f27]" /> docs sent
    </span>;
  }
  return <span className="text-[13px] text-[#8ab3a1]">not sent</span>;
}

// ── EPC Health formatters + cards ────────────────────────────────────
const numFmt  = (v: number) => v.toLocaleString("en-IN");
const pctFmt  = (r: number) => `${Math.round(r * 100)}%`;
const lacsFmt = (v: number) => `₹${(v / 100000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} Lacs`;

// One paired metric row inside a segment tab (label left, value right).
function HealthRow({ label, value, accent, green }: { label: string; value: string; accent?: boolean; green?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-[#eef1f4]">
      <span className="text-[15px] text-[#334155]">{label}</span>
      <span className={"text-[15px] font-semibold " + (green ? "text-[#178a5c]" : accent ? "text-[#185fa5]" : "text-[#0f3d2e]")}>
        {value}
      </span>
    </div>
  );
}

// The full paired-metrics card for a segment (Applications↔Approval ratio, etc.).
function MetricsCard({ b }: { b: HealthBucket }) {
  return (
    <div className="rounded-[12px] border border-[#e0f0e8] bg-white p-4 sm:p-5 h-full">
      <div className="grid sm:grid-cols-2 gap-x-8 gap-y-0">
        <HealthRow label="Applications Submitted" value={numFmt(b.submitted)} />
        <HealthRow label="Approval ratio" value={pctFmt(b.approvalRatio)} accent />
        <HealthRow label="Rejected" value={numFmt(b.rejected)} />
        <HealthRow label="Cancellation ratio" value={pctFmt(b.cancellationRatio)} />
        <HealthRow label="Approval Amount" value={lacsFmt(b.approvalAmount)} green />
        <HealthRow label="Disbursed" value={lacsFmt(b.disbursed)} />
        <HealthRow label="Pending Disbursed" value={lacsFmt(b.pending)} />
      </div>
    </div>
  );
}

// A small headline stat card (transaction volume / repeat customers).
function MiniStat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={"rounded-[12px] border border-[#e0f0e8] bg-white p-4 flex flex-col justify-center " + (className ?? "")}>
      <div className="text-[12px] font-semibold uppercase tracking-wide text-[#5a8a76]">{label}</div>
      <div className="text-[26px] font-bold text-[#0f3d2e] mt-1 leading-none">{value}</div>
    </div>
  );
}

// Main admin only: the EPC's login password (0110), hidden until the eye is
// clicked — read once then, never on page load.
function PasswordKV({ businessId }: { businessId: string }) {
  const [pw, setPw] = useState<string | null | undefined>(undefined); // undefined = not read yet
  const [shown, setShown] = useState(false);
  async function toggle() {
    if (!shown && pw === undefined) {
      try { setPw(await epcLoginPassword(businessId)); } catch { toast.error("Couldn't load the password"); return; }
    }
    setShown((s) => !s);
  }
  return (
    <div className="flex justify-between text-[14px] py-[5px] gap-3">
      <span className="text-[#5a8a76] shrink-0">Password</span>
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="text-right min-w-0 truncate font-medium text-[#0f3d2e]">{shown ? pw ?? "—" : "••••••••"}</span>
        {shown && pw && <CopyButton value={pw} />}
        <button type="button" onClick={toggle} aria-label={shown ? "Hide password" : "Show password"} title={shown ? "Hide password" : "Show password"}
          className="p-1 rounded text-[#5a8a76] hover:text-[#0f3d2e]">
          {I.eye}
        </button>
      </span>
    </div>
  );
}

// The blended EPC score as a compact header pill, coloured by band
// (strong / fair / needs attention).
function HeaderScore({ score }: { score: number }) {
  const t = scoreTone(score);
  return (
    <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 shrink-0" style={{ backgroundColor: t.bg, borderColor: t.border }}>
      <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: t.text }}>EPC Score</span>
      <span className="text-[17px] font-bold leading-none" style={{ color: t.text }}>{score}</span>
      <span className="text-[11px] font-semibold" style={{ color: t.text }}>/100 · {t.label}</span>
    </span>
  );
}

// Installation-TAT ageing bands. The whole card takes the colour of whichever
// band holds the most in-progress applications (older band wins ties).
function TatCard({ tat, className }: { tat: TatBands; className?: string }) {
  const TONE: Record<string, { dot: string; text: string; label: string }> = {
    green:  { dot: "#16a34a", text: "#0f7a52", label: "On track" },
    yellow: { dot: "#eab308", text: "#8a5a00", label: "Watch" },
    red:    { dot: "#dc2626", text: "#b42318", label: "High alert" },
    none:   { dot: "#cbd5e1", text: "#5a8a76", label: "Nothing in progress" },
  };
  const t = TONE[tat.alert];
  const bands = [
    { label: "≤ 60 days", value: tat.le60, color: "#16a34a", active: tat.alert === "green" },
    { label: "60–90 days", value: tat.d60_90, color: "#eab308", active: tat.alert === "yellow" },
    { label: "> 90 days", value: tat.gt90, color: "#dc2626", active: tat.alert === "red" },
  ];
  return (
    <div className={"rounded-[12px] border border-[#e0f0e8] bg-white p-4 " + (className ?? "")}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-[#5a8a76]">Installation TAT</div>
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: t.text }}>
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.dot }} />
          {t.label}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {bands.map((band) => (
          <div key={band.label}
            className="rounded-[10px] border px-3 py-2.5 text-center"
            style={{ borderColor: band.active ? band.color : "#eef1f4", backgroundColor: band.active ? band.color + "14" : "#fbfdfc" }}>
            <div className="text-[22px] font-bold" style={{ color: band.color }}>{band.value}</div>
            <div className="text-[11px] font-medium text-[#5a8a76] mt-0.5">{band.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtCapacity(n: number | null | undefined, unit: string | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const u = unit === "KW" ? "kW" : unit === "MW" ? "MW" : (unit ?? "");
  return `${n} ${u}`.trim();
}

// Team size: prefer the split Technical/Non-Technical counts; fall back to
// the legacy combined free-text value for historical rows.
function fmtTeam(ai: AdminInfo | null): string | null {
  if (!ai) return null;
  if (ai.team_technical != null || ai.team_non_technical != null) {
    const t = ai.team_technical != null ? String(ai.team_technical) : "—";
    const nt = ai.team_non_technical != null ? String(ai.team_non_technical) : "—";
    return `${t} tech · ${nt} non-tech`;
  }
  return ai.team_size ?? null;
}

// Turnover: prefer the numeric ₹ Lakhs value; fall back to the legacy
// free-text value for historical rows.
function fmtTurnover(ai: AdminInfo | null): string | null {
  if (!ai) return null;
  if (ai.turnover_lakhs != null) return `₹${ai.turnover_lakhs} Lakhs`;
  return ai.turnover_last_fy ?? null;
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ── DocumentsBySteps ─────────────────────────────────────────────────
//
// Renders the EPC's documents grouped by the onboarding step that
// produced them, in step order. Sections with zero docs are hidden so
// the panel stays compact. Stakeholder docs are further grouped per
// stakeholder with role-based labels (Proprietor / Director N / Partner
// N / Stakeholder N) that fall back to "Stakeholder N" when
// business_type is null.
//
// Signed-URL viewing (openDoc) is unchanged.

const BUSINESS_STEP_CATS = ["pan_business", "gstin", "extra_doc"] as const;
const STAKEHOLDER_CATS = [
  "stakeholder_pan",
  "stakeholder_aadhaar_front",
  "stakeholder_aadhaar_back",
  "stakeholder_aadhaar",
] as const;
const BANK_CATS   = ["cancelled_cheque", "bank_statement"] as const;
const OFFICE_CATS = ["office_exterior", "office_interior", "office_selfie"] as const;

type DocSlot = { key: string; label: string; doc: Doc | null };
type Stakeholder = { id: string; name?: string; designation?: string; mobile?: string; email?: string };

// Build the slot list for a doc family: one slot per expected category
// (present → eye-View, absent → greyed "Not uploaded"), followed by any
// extra uploaded docs that don't map to an expected slot so nothing is
// hidden.
function buildSlots(
  familyDocs: Doc[],
  expectedCats: string[],
  labelFn: (cat: string) => string,
): DocSlot[] {
  const used = new Set<string>();
  const slots: DocSlot[] = expectedCats.map((cat, i) => {
    const doc = familyDocs.find((d) => d.category === cat && !used.has(d.id)) ?? null;
    if (doc) used.add(doc.id);
    return { key: `${cat}-${i}`, label: labelFn(cat), doc };
  });
  familyDocs
    .filter((d) => !used.has(d.id))
    .forEach((d) => slots.push({ key: `x-${d.id}`, label: labelFn(d.category), doc: d }));
  return slots;
}

// The documents an EPC profile should have, grouped as the Documents card shows
// them: each expected slot (empty → "Not uploaded") plus any extra uploads.
function epcDocGroups(docs: Doc[], stakeholders: Stakeholder[], businessType: string | null) {
  // Bucket docs by category family.
  const byCat = (cats: readonly string[]) =>
    docs.filter((d) => cats.includes(d.category));

  const bizDocs    = byCat(BUSINESS_STEP_CATS);
  const stkDocs    = byCat(STAKEHOLDER_CATS);
  const bankDocs   = byCat(BANK_CATS);
  const officeDocs = byCat(OFFICE_CATS);
  const knownCats: readonly string[] =
    [...BUSINESS_STEP_CATS, ...STAKEHOLDER_CATS, ...BANK_CATS, ...OFFICE_CATS];
  const otherDocs  = docs.filter((d) => !knownCats.includes(d.category));

  const stakeholderIndex = new Map<string, number>();
  stakeholders.forEach((s, i) => stakeholderIndex.set(s.id, i));

  // Group stakeholder docs by stakeholder_id, preserving stakeholder order.
  const stakeholderGroups = stakeholders.map((s) => ({
    stakeholder: s,
    docs: stkDocs.filter((d) => d.stakeholder_id === s.id),
  }));
  // Orphan stakeholder docs (stakeholder_id that doesn't match any current row).
  const orphanStakeholderDocs = stkDocs.filter(
    (d) => !d.stakeholder_id || !stakeholderIndex.has(d.stakeholder_id),
  );

  // Expected document sets — missing ones render greyed as "Not uploaded".
  const hasExtraDoc =
    businessType === "partnership" || businessType === "pvt_ltd" || businessType === "llp";
  const bizExpected = hasExtraDoc
    ? ["pan_business", "gstin", "extra_doc"]
    : ["pan_business", "gstin"];
  const bizSlots    = buildSlots(bizDocs, bizExpected, (c) => businessDocLabel(c, businessType));
  const bankSlots   = buildSlots(bankDocs, ["cancelled_cheque"], (c) => c === "cancelled_cheque" ? "Empty cheque copy / picture" : DOC_LABEL(c));
  const officeSlots = buildSlots(
    officeDocs,
    ["office_exterior", "office_interior", "office_selfie"],
    (c) => officeDocLabel(c, businessType),
  );
  const STK_EXPECTED = ["stakeholder_pan", "stakeholder_aadhaar_front", "stakeholder_aadhaar_back"];
  const stakeholderSlots = stakeholderGroups.map((g, i) => ({
    key: g.stakeholder.id ?? String(i),
    header: stakeholderRoleTag(businessType, i, stakeholders.length) + (g.stakeholder.name ? ` — ${g.stakeholder.name}` : ""),
    slots: buildSlots(g.docs, STK_EXPECTED, (c) => stakeholderDocLabel(businessType, i, stakeholders.length, c)),
  }));
  return { bizSlots, stakeholderSlots, orphanStakeholderDocs, bankSlots, officeSlots, otherDocs };
}

// Every document slot the profile counts (uploaded or not).
function expectedEpcSlots(docs: Doc[], stakeholders: Stakeholder[], businessType: string | null): DocSlot[] {
  const g = epcDocGroups(docs, stakeholders, businessType);
  // An older single-file Aadhaar (both sides in one) covers front + back.
  const stk = g.stakeholderSlots.flatMap((x) => {
    const combined = x.slots.some((s) => s.doc?.category === "stakeholder_aadhaar");
    return x.slots.filter((s) => !(combined && /^stakeholder_aadhaar_(front|back)-/.test(s.key)));
  });
  return [...g.bizSlots, ...stk, ...g.bankSlots, ...g.officeSlots];
}

// Labels of the expected documents not uploaded yet.
function missingEpcDocs(docs: Doc[], stakeholders: Stakeholder[], businessType: string | null): string[] {
  return expectedEpcSlots(docs, stakeholders, businessType).filter((x) => !x.doc).map((x) => x.label);
}

function DocumentsBySteps({
  docs, stakeholders, businessType, openDoc, removeDoc, downloadDoc, eyeIcon,
}: {
  docs: Doc[];
  stakeholders: Stakeholder[];
  businessType: string | null;
  openDoc: (id: string) => void;
  removeDoc: (id: string) => void;
  downloadDoc: (id: string) => void;
  eyeIcon: React.ReactNode;
}) {
  const { bizSlots, stakeholderSlots, orphanStakeholderDocs, bankSlots, officeSlots, otherDocs } =
    epcDocGroups(docs, stakeholders, businessType);
  return (
    <div className="space-y-4">
      <StepBlock title="Business (Step 2)">
        <DocGrid slots={toViewSlots(bizSlots, openDoc, removeDoc, downloadDoc)} eyeIcon={eyeIcon} />
      </StepBlock>

      {(stakeholderSlots.length > 0 || orphanStakeholderDocs.length > 0) && (
        <StepBlock title="Stakeholders (Step 3)">
          <div className="space-y-2.5">
            {stakeholderSlots.map((g) => (
              <StakeholderDocs
                key={g.key}
                header={g.header}
                slots={g.slots}
                openDoc={openDoc}
                removeDoc={removeDoc}
                downloadDoc={downloadDoc}
                eyeIcon={eyeIcon}
              />
            ))}
            {orphanStakeholderDocs.length > 0 && (
              <StakeholderDocs
                header="Legacy stakeholder documents"
                slots={buildSlots(orphanStakeholderDocs, [], (c) => plainStakeholderCatLabel(c))}
                openDoc={openDoc}
                removeDoc={removeDoc}
                downloadDoc={downloadDoc}
                eyeIcon={eyeIcon}
              />
            )}
          </div>
        </StepBlock>
      )}

      <StepBlock title="Bank (Step 4)">
        <DocGrid slots={toViewSlots(bankSlots, openDoc, removeDoc, downloadDoc)} eyeIcon={eyeIcon} />
      </StepBlock>

      <StepBlock title="Office (Step 5)">
        <DocGrid slots={toViewSlots(officeSlots, openDoc, removeDoc, downloadDoc)} eyeIcon={eyeIcon} />
      </StepBlock>

      {otherDocs.length > 0 && (
        <StepBlock title="Other">
          <DocGrid slots={toViewSlots(buildSlots(otherDocs, [], (c) => DOC_LABEL(c)), openDoc, removeDoc, downloadDoc)} eyeIcon={eyeIcon} />
        </StepBlock>
      )}
    </div>
  );
}

// Maps this page's doc-row slots onto the shared ViewKit DocGrid slots.
// `doc` present → eye-View button; absent → greyed "Not uploaded".
function toViewSlots(
  slots: DocSlot[], openDoc: (id: string) => void, removeDoc?: (id: string) => void,
  downloadDoc?: (id: string) => void,
): ViewDocSlot[] {
  return slots.map((s) => ({
    key: s.key,
    label: s.label,
    title: s.doc?.file_name ?? undefined,
    onView: s.doc ? () => openDoc(s.doc!.id) : undefined,
    onDownload: s.doc && downloadDoc ? () => downloadDoc(s.doc!.id) : undefined,
    onDelete: s.doc && removeDoc ? () => removeDoc(s.doc!.id) : undefined,
  }));
}

function StakeholderDocs({
  header, slots, openDoc, removeDoc, downloadDoc, eyeIcon,
}: {
  header: string;
  slots: DocSlot[];
  openDoc: (id: string) => void;
  removeDoc?: (id: string) => void;
  downloadDoc?: (id: string) => void;
  eyeIcon: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[12px] font-semibold text-[#0f3d2e] mb-1.5">{header}</p>
      <DocGrid slots={toViewSlots(slots, openDoc, removeDoc, downloadDoc)} eyeIcon={eyeIcon} />
    </div>
  );
}

// ── Label helpers ────────────────────────────────────────────────────

function businessDocLabel(cat: string, bt: string | null): string {
  if (cat === "pan_business") return "PAN card";
  if (cat === "gstin")        return "GST registration";
  if (cat === "extra_doc") {
    if (bt === "partnership") return "Partnership Deed";
    if (bt === "pvt_ltd")     return "Certificate of Incorporation";
    if (bt === "llp")         return "LLP Agreement";
    return "Extra document";
  }
  return DOC_LABEL(cat);
}

function officeDocLabel(cat: string, bt: string | null): string {
  if (cat === "office_exterior") return "Exterior photo";
  if (cat === "office_interior") return "Interior photo";
  if (cat === "office_selfie") {
    switch (bt) {
      case "proprietorship":         return "Selfie of proprietor at office";
      case "partnership":
      case "llp":                    return "Selfie of at least 1 partner at office";
      case "pvt_ltd":                return "Selfie of at least 1 director at office";
      default:                       return "Selfie at office";
    }
  }
  return DOC_LABEL(cat);
}

// Role tag for a stakeholder header row.
// Proprietorship never carries a number (there's only one row).
function stakeholderRoleTag(bt: string | null, index: number, total: number): string {
  if (bt === "proprietorship") return "Proprietor";
  const role = roleLabel(bt);
  return `${role} ${index + 1}`;
}

// Label for a single stakeholder-doc card. Prefixed with the role tag
// (e.g. "Partner 1 PAN", "Director 2 Aadhaar (back)"). Proprietorship
// omits the number.
function stakeholderDocLabel(bt: string | null, index: number, total: number, cat: string): string {
  const prefix = bt === "proprietorship"
    ? "Proprietor"
    : `${roleLabel(bt)} ${index + 1}`;
  switch (cat) {
    case "stakeholder_pan":            return `${prefix} PAN`;
    case "stakeholder_aadhaar_front":  return `${prefix} Aadhaar (front)`;
    case "stakeholder_aadhaar_back":   return `${prefix} Aadhaar (back)`;
    case "stakeholder_aadhaar":        return `${prefix} Aadhaar (legacy)`;
    default:                           return `${prefix} ${DOC_LABEL(cat)}`;
  }
}

// Used when a stakeholder-doc row can't be attributed to a live
// stakeholder (orphaned by a Step-3 destructive-trim, for instance).
function plainStakeholderCatLabel(cat: string): string {
  switch (cat) {
    case "stakeholder_pan":            return "PAN";
    case "stakeholder_aadhaar_front":  return "Aadhaar (front)";
    case "stakeholder_aadhaar_back":   return "Aadhaar (back)";
    case "stakeholder_aadhaar":        return "Aadhaar (legacy)";
    default:                           return DOC_LABEL(cat);
  }
}
