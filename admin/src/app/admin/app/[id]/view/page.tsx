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
import { getToken, getBusiness, isMainAdmin } from "@/lib/auth";
import { getDocumentUrl, deleteDocument } from "@/lib/storage";
import DeleteLoanAppModal from "@/components/DeleteLoanAppModal";
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
  latestLenderStatus, lendersWithDocs, approvedLenders,
} from "@/lib/loan-lenders";
import LenderPickerModal, { type LenderKey } from "@/components/LenderPickerModal";
import { useLenders } from "@/lib/lenders";
import EmailComposerModal from "@/components/EmailComposerModal";
import { DownloadMenu, KebabMenu } from "@/components/ProfileTabBar";
import { logLoanActivity } from "@/lib/loanAudit";
import { aadhaarFaceCountsAsPhoto } from "@/lib/applicant-photo";
import { loanDocChecklist } from "@/lib/loan-doc-checklist";
import { loanChecks } from "@/lib/loan-verification";
import { cachedLoanUpdateCount } from "@/lib/use-epc-updates";
import { deadlineState, DEADLINE_PILL, remainingAmount, fmtDateShort } from "@/lib/disbursement";
import { fmtDateTime } from "@/lib/dates";
import { fmtRupees, fmtRupeesExact } from "@/lib/money";
import { initialsOf } from "@/lib/names";
import { invalidateLoanBoards } from "@/lib/ops-board";
import {
  I, DocGrid, DocViewer, FieldCol, FillCount, fieldFill, fillText, fillTone, ProgressTabs, ChecksPanel, CopyButton, Section, StatCards, StepBlock,
  type FieldRow, type ViewDocSlot, type ViewerItem, type StageState,
} from "@/components/view/ViewKit";
import LoanApprovalForm from "@/components/LoanApprovalForm";
import LoanDisbursementPanel from "@/components/LoanDisbursementPanel";

type Loan = Record<string, any>;
type Doc  = {
  id: string; category: string; storage_path: string; file_name: string | null; mime_type: string | null;
  created_at?: string | null;
};
// Another application with the same mobile / PAN / K number (Checks → Duplicate).
type DupRow = {
  id: string; loan_display_id: string | null; aadhaar_name: string | null; borrower_name: string | null;
  status: string | null; aborted_at: string | null; created_at: string | null;
  borrower_mobile: string | null; borrower_pan: string | null; ca_number: string | null;
};
// Signed URLs for every document, minted in ONE request (doc-urls) — pictures,
// the header photo and instant View. They live 1h; reuse them for 50 min.
type SignedUrls = { rows: Record<string, string>; paths: Record<string, string>; at: number };
const URL_TTL_MS = 50 * 60_000;

type Stage = "submitted" | "docs" | "approved" | "first" | "second";

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
// "Message EPC" — a chat bubble with text lines.
const MSG_EPC = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z" />
    <path d="M8.5 10.5h7M8.5 14h4.5" />
  </svg>
);

function displayId(loan: Loan): string {
  if (loan.loan_display_id) return loan.loan_display_id;
  return "LA-" + String(loan.id).replace(/-/g, "").slice(0, 8).toUpperCase();
}
// fmtRupees imported from @/lib/money
function fmtDate(v: string | null | undefined): string {
  return fmtDateTime(v);
}
function maskAcct(a: string | null | undefined): string {
  if (!a) return "—";
  if (a.length <= 4) return "•".repeat(6) + a;
  return "•".repeat(Math.max(6, a.length - 4)) + a.slice(-4);
}
function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
// Approval-details cell: money → ₹ exact (never rounded), tenure → "<n> years". Numbers only.
function fmtApproval(v: number | null | undefined, money: boolean, suffix?: string): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  const base = money ? fmtRupeesExact(n) : String(n);
  return suffix ? `${base} ${suffix}` : base;
}

// ── Document grouping (missing-doc visibility) ───────────────────────

type LoanSlot = {
  key: string; label: string; docId: string | null; path: string | null;
  // Viewer details (filled when the slot has a file).
  file?: string | null; mime?: string | null; at?: string | null;
};
type LoanDocGroup = { title: string; slots: LoanSlot[] };

// Upload time of a *_path document: its *_uploaded_at column when there is one,
// else the Date.now() prefix every upload route puts in the object name.
const PATH_UPLOADED_AT: Record<string, string> = {
  quotation: "proforma_uploaded_at", ebill: "ebill_uploaded_at",
  rooftop: "rooftop_photo_uploaded_at", bank_statement: "bank_statement_uploaded_at",
};
function pathUploadedAt(loan: Loan, key: string, path: string): string | null {
  const col = PATH_UPLOADED_AT[key];
  if (col && loan[col]) return String(loan[col]);
  const m = /\/(\d{13})[_.]/.exec(path);
  return m ? new Date(Number(m[1])).toISOString() : null;
}

// Every user_application_docs category that a NAMED slot below owns. Any row in
// one of these categories belongs to its slot — never to "Other documents".
// This keeps a duplicate upload (e.g. a rooftop photo uploaded twice, or via
// both the chatbot and the classic form) from leaking a second "Rooftop photo" /
// "Applicant photo" card into the Other bucket. Extra copies are simply hidden;
// the slot shows the latest one.
const NAMED_SLOT_CATEGORIES = new Set<string>([
  "borrower_pan", "customer_photo", "borrower_photo", "quotation", "electricity_bill",
  "bank_statement", "sanction_letter", "feasibility_report", "mmr_advance_receipt",
  "completion_invoice", "completion_panel_photo", "completion_inverter_photo",
  "completion_meter_photo", "completion_report",
]);

function buildLoanDocGroups(loan: Loan, docsIn: Doc[]): LoanDocGroup[] {
  // Newest first, so a slot that matches by category shows the LATEST upload and
  // any older duplicate is superseded (not the stale first copy).
  const docs = [...docsIn].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  const usedRowIds = new Set<string>();
  const fromRow = (key: string, label: string, d: Doc): LoanSlot => ({
    key, label, docId: d.id, path: null, file: d.storage_path, mime: d.mime_type, at: d.created_at ?? null,
  });
  const fromPath = (key: string, label: string, path: string | null | undefined): LoanSlot => ({
    key, label, docId: null, path: path ?? null, file: path ?? null, at: path ? pathUploadedAt(loan, key, path) : null,
  });
  const slot = (
    key: string, label: string, cats: string[], path: string | null | undefined,
  ): LoanSlot => {
    for (const cat of cats) {
      const row = docs.find((d) => d.category === cat && !usedRowIds.has(d.id));
      if (row) { usedRowIds.add(row.id); return fromRow(key, label, row); }
    }
    return fromPath(key, label, path);
  };

  const groups: LoanDocGroup[] = [];

  groups.push({
    title: "Identity (Steps 1–2)",
    slots: [
      slot("applicant_pan",   "Applicant PAN card", ["borrower_pan"],   null),
      slot("applicant_photo", "Applicant photo",    ["customer_photo"], loan.customer_photo_path ?? (aadhaarFaceCountsAsPhoto(loan) ? loan.aadhaar_face_path : null)),
      slot("aadhaar_front",   "Aadhaar (front)",    [], loan.aadhaar_front_path),
      slot("aadhaar_back",    "Aadhaar (back)",     [], loan.aadhaar_back_path),
    ],
  });

  groups.push({
    title: "Loan requirement (Step 3)",
    slots: [
      slot("quotation", "Quotation / Proforma invoice", ["quotation"],        loan.proforma_invoice_path),
      ...billSlots(),
      slot("rooftop",   "Rooftop photo",                ["borrower_photo"],   loan.rooftop_photo_path),
    ],
  });

  // Electricity bills: the read bill (ebill_path) first, then every other
  // electricity_bill row — a commercial customer may add more than one; the
  // classic form stores its bills as rows only. A row holding the same file as
  // the column is the same bill.
  function billSlots(): LoanSlot[] {
    const rows = docs.filter((d) => d.category === "electricity_bill" && !usedRowIds.has(d.id) && d.storage_path !== loan.ebill_path);
    docs.forEach((d) => { if (d.category === "electricity_bill") usedRowIds.add(d.id); });
    const out: LoanSlot[] = [];
    if (loan.ebill_path) out.push(fromPath("ebill", "Electricity bill", loan.ebill_path));
    rows.reverse().forEach((d) => out.push(fromRow(`ebill_${d.id}`, "Electricity bill", d)));
    if (out.length === 0) out.push(fromPath("ebill", "Electricity bill", null));
    if (out.length > 1) out.forEach((s, i) => { s.label = `Electricity bill ${i + 1}`; });
    return out;
  }

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
    bankSlots.push(fromPath("bank_statement", "Bank statement", loan.bank_statement_path));
  }
  bankRows.forEach((d) => {
    bankSlots.push(fromRow(`bank_statement_${d.id}`, "Bank statement", d));
  });
  if (bankSlots.length === 0) {
    bankSlots.push(fromPath("bank_statement", "Bank statement", null));
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

  // "Other documents" = rows not consumed by a slot AND not owned by any named
  // category. A duplicate of a named category (borrower_photo / customer_photo /
  // borrower_pan / …) is never shown here — its slot already shows the latest.
  const others = docs.filter((d) => !usedRowIds.has(d.id) && !NAMED_SLOT_CATEGORIES.has(d.category));
  if (others.length > 0) {
    groups.push({
      title: "Other documents",
      // An "other" upload is shown by its file name — the EPC chatbot names it
      // after what the document is ("ITR 2024-25").
      slots: others.map((d) => fromRow(
        `other-${d.id}`,
        d.category === "other" && d.file_name ? d.file_name.replace(/\.[^.]+$/, "") : DOC_LABEL[d.category] ?? d.category.replace(/_/g, " "),
        d,
      )),
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
  const searchParams = useSearchParams();
  const didAutoOpen = useRef(false);
  // Where "Back" should go. When you arrive from the Task Manager, we stash
  // "/admin/board" in sessionStorage so Back returns there, not the console.
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const lenders = useLenders();
  useEffect(() => { if (typeof window !== "undefined") setReturnTo(sessionStorage.getItem("ccReturnTo")); }, []);
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
  function goBack() {
    const to = typeof window !== "undefined" ? sessionStorage.getItem("ccReturnTo") : null;
    if (to) { sessionStorage.removeItem("ccReturnTo"); router.push(to as unknown as string); }
    else router.push("/admin");
  }
  const [loan, setLoan] = useState<Loan | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusBusy, setStatusBusy] = useState(false);
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
  // Open stage tab — null = the case's current stage.
  const [tab, setTab] = useState<Stage | null>(null);
  // Lender whose approval form is open on the Approved stage (picked, or
  // "Change lender"); null = the saved / only lender.
  const [formLender, setFormLender] = useState<PickerLender | null>(null);
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
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
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
  const urlForPath = async (path: string) => fresh(urls?.paths[path]) ?? await signPath(path);

  async function openDoc(id: string) {
    const url = await urlForDoc(id);
    if (url) window.open(url, "_blank", "noopener");
  }

  // Click a hidden anchor to a URL that the server signed with
  // Content-Disposition: attachment, so the browser saves it instead of
  // navigating away.
  function triggerDownload(url: string) {
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function downloadDoc(id: string) {
    const url = await getDocumentUrl(id, { download: true });
    if (url) triggerDownload(url);
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
    const url = await urlForPath(path);
    if (url) window.open(url, "_blank", "noopener");
  }

  async function downloadPath(path: string) {
    try {
      const res = await fetch(`/api/admin/loan-app/${params.id}/sign-doc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ path, download: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok && data.url) triggerDownload(data.url as string);
    } catch { /* best effort */ }
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
      setStatusMsg("Couldn't update status — " + error.message);
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
      `Rejected by ${lenderLabelIn(lenders, lender)}${why ? ` — ${why}` : ""}`,
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
  const decidedByLabel = decidedLender ? lenderLabelIn(lenders, String(decidedLender)) : null;
  const approvalDetails = (loan.approval_details ?? null) as ApprovalDetails | null;

  const dl = deadlineState(loan.first_disbursement_date, loan.second_disbursement_amount != null);
  const firstDone  = loan.first_disbursement_amount != null;
  const secondDone = loan.second_disbursement_amount != null;
  const reviewLabel = ["approved", "rejected"].includes(String(loan.completion_docs_status))
    ? "Reviewed" : "Pending";

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
  const latest = latestLenderStatus(lenderRows);
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
  const tDecided  = tApproved || tRejected;

  // Tranche ZIPs are offered in the Download menu only when that tranche's
  // documents actually exist (no empty-tranche ZIP).
  const tranche1Exists = docs.some((d) => ["feasibility_report", "mmr_advance_receipt"].includes(d.category));
  const tranche2Exists = docs.some((d) =>
    ["completion_invoice", "completion_panel_photo", "completion_inverter_photo", "completion_meter_photo", "completion_report"].includes(d.category),
  );

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
    await supabase().from("epc_applications").update(patch).eq("id", loan.id);
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
          await supabase().from("loan_application_lenders").update({ docs_sent_at: new Date().toISOString() }).eq("id", existing.id);
        }
      } else {
        await supabase().from("loan_application_lenders").insert({ application_id: loan.id, lender_key: lender.key, lender_label: lender.label, docs_sent_at: new Date().toISOString() });
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
      if (existing) await supabase().from("loan_application_lenders").update(patch).eq("id", existing.id);
      else await supabase().from("loan_application_lenders").insert({ application_id: loan.id, lender_key: lender.key, lender_label: lender.label, docs_sent_at: new Date().toISOString(), ...patch });
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
      };
      await supabase().from("epc_applications").update(patch).eq("id", loan.id);
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
  async function doAbort(reason: string) {
    if (!loan || statusBusy) return;
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
    if (error) { setStatusMsg("Couldn't abort — " + error.message); setStatusBusy(false); return; }
    setLoan({ ...loan, ...patch });
    invalidateLoanBoards(); // abort reflects on the Task Manager / Loans list immediately
    setStatusMsg("Application aborted.");
    await logLoanActivity(loan.id, "status_change", { detail: `Aborted — ${reason}` });
    setStatusBusy(false);
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
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
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
  const decidedAt = tApproved
    ? lenderRows.find((r) => r.lender_key === loan.approved_lender)?.approved_at ?? loan.approved_at ?? null
    : tRejected ? loan.rejected_at ?? null : null;
  const withWhen = (what: ReactNode, at: string | null | undefined) =>
    at ? <>{what}<br />{fmtDateTime(at)}</> : what;
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
      sub: decidedByLabel ? withWhen(decidedByLabel, decidedAt) : tDocsSent ? "Awaiting decision" : "Pending",
    },
    {
      key: "first", label: "1st Disbursement", icon: I.money,
      state: held("first", firstDone ? "done" : tApproved ? "current" : "pending"),
      sub: firstDone ? fmtDateShort(loan.first_disbursement_date) : tApproved ? <><FillCount have={t1Have} total={t1Need.length} /> documents</> : "Pending",
    },
    {
      key: "second", label: "2nd Disbursement", icon: I.check,
      state: held("second", secondDone ? "done" : firstDone ? "current" : "pending"),
      sub: secondDone ? fmtDateShort(loan.second_disbursement_date) : firstDone ? <><FillCount have={t2Have} total={COMPLETION_CATEGORIES.length} /> documents</> : "Pending",
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
  const dupList = dups && dups.length > 0 ? (
    <ul className="space-y-1">
      {dups.map((d) => {
        const why = [
          d.borrower_mobile && d.borrower_mobile === loan.borrower_mobile ? "Mobile" : null,
          d.borrower_pan && d.borrower_pan === loan.borrower_pan ? "PAN" : null,
          d.ca_number && d.ca_number === loan.ca_number ? "K No." : null,
        ].filter(Boolean).join(" · ");
        return (
          <li key={d.id} className="text-[12px]">
            <a href={`/admin/app/${d.id}/view`} target="_blank" rel="noopener" className="font-semibold text-[#185fa5] hover:underline">
              {d.loan_display_id ?? "—"}
            </a>
            <span className="text-[#7a958a]"> · {d.aadhaar_name || d.borrower_name || "—"} · {why} · {d.aborted_at ? "Aborted" : (LOAN_STATUS_LABEL[d.status ?? ""] ?? d.status)}</span>
          </li>
        );
      })}
    </ul>
  ) : null;

  const approvedAmt = tApproved ? (loan.sanctioned_amount ?? approvalDetails?.approved_loan_amount ?? null) : null;
  const disbursedAmt = Number(loan.first_disbursement_amount ?? 0) + Number(loan.second_disbursement_amount ?? 0);
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

  // ── Submitted — every field, per column (optional ones don't count) ──
  const yesNo = (v: unknown) => (v == null ? null : v ? "Yes" : "No");
  const applicantRows: FieldRow[] = [
    { k: "Name", v: loan.aadhaar_name || loan.borrower_name },
    { k: "Lead owner", v: loan.lead_owner_name, optional: true },
    { k: "Father's name", v: loan.borrower_father_name },
    { k: "Gender", v: loan.aadhaar_gender },
    { k: "Date of birth", v: loan.aadhaar_dob },
    { k: "PAN", v: loan.borrower_pan, copy: loan.borrower_pan },
    { k: "Aadhaar", v: loan.aadhaar_number_masked },
    { k: "Email", v: loan.borrower_email, valueClass: "text-[#185fa5]", copy: loan.borrower_email },
    { k: "Phone no", v: loan.borrower_mobile ? `+91 ${loan.borrower_mobile}` : null, copy: loan.borrower_mobile },
    { k: "Earning", v: yesNo(loan.applicant_earning) },
    { k: "Monthly income", v: loan.monthly_income != null ? fmtRupees(loan.monthly_income) : null, optional: loan.applicant_earning !== true },
    { k: "Address", v: loan.aadhaar_address, wrap: true },
  ];
  const coappRows: FieldRow[] = hasCoapp ? [
    { k: "Name", v: loan.coapp_name },
    { k: "Father's name", v: loan.coapp_father_name },
    { k: "DOB", v: loan.coapp_dob },
    { k: "Relation", v: loan.coapp_relation },
    { k: "Reason", v: loan.coapp_role_reason, wrap: true, optional: true },
    { k: "PAN", v: loan.coapp_pan, copy: loan.coapp_pan },
    { k: "Mobile", v: loan.coapp_mobile ? `+91 ${loan.coapp_mobile}` : null, copy: loan.coapp_mobile },
    { k: "Email", v: loan.coapp_email, copy: loan.coapp_email, optional: true },
    { k: "Earning", v: yesNo(loan.coapp_earning) },
    { k: "Monthly income", v: loan.coapp_monthly_income != null ? fmtRupees(loan.coapp_monthly_income) : null, optional: loan.coapp_earning !== true },
    { k: "Aadhaar name", v: loan.coapp_aadhaar_name },
    { k: "Aadhaar", v: loan.coapp_aadhaar_number_masked },
    { k: "Address", v: loan.coapp_aadhaar_address, wrap: true },
  ] : [];
  const gps = loan.rooftop_photo_gps as { lat?: number; lng?: number } | null;
  const siteRows: FieldRow[] = [
    { k: "Name on E-Bill", v: loan.ebill_name },
    { k: "Address", v: loan.ebill_address_line, wrap: true },
    { k: "Pincode", v: loan.install_pincode },
    { k: "City", v: loan.install_city },
    { k: "District", v: loan.install_district },
    { k: "State", v: loan.install_state },
    ...(gps ? [{ k: "Rooftop GPS", v: `${gps.lat?.toFixed?.(5) ?? "?"}, ${gps.lng?.toFixed?.(5) ?? "?"}`, optional: true }] : []),
  ];
  const loanRows: FieldRow[] = [
    { k: "Project size", v: kw },
    { k: "Project cost", v: fmtRupees(loan.total_project_cost) },
    { k: "Loan amount required", v: fmtRupees(loan.loan_amount_required) },
    {
      k: "Down payment",
      v: loan.total_project_cost && loan.loan_amount_required
        ? fmtRupees(Math.max(0, Number(loan.total_project_cost) - Number(loan.loan_amount_required)))
        : null,
      optional: true,
    },
    { k: "System type", v: loan.system_type ? SYSTEM_LABEL[loan.system_type] ?? loan.system_type : null },
    { k: "Monthly bill", v: fmtRupees(loan.monthly_bill_amount) },
    { k: "DISCOM", v: loan.discom_name },
    { k: "K Number", v: loan.ca_number, copy: loan.ca_number },
  ];
  const employmentRows: FieldRow[] = [
    { k: "Employment", v: loan.employment_type ? EMPLOYMENT_LABEL[loan.employment_type] ?? loan.employment_type : null },
    { k: "Organization", v: loan.organization_name, optional: loan.employment_type !== "salaried" },
    { k: "Profession", v: loan.profession === "Other" && loan.profession_other ? `Other — ${loan.profession_other}` : loan.profession, optional: loan.employment_type !== "self_employed" },
    { k: "Annual income", v: fmtRupees(loan.annual_income) },
  ];
  const bankRows: FieldRow[] = [
    { k: "Bank name", v: loan.bank_name },
    { k: "Account holder", v: loan.bank_account_holder },
    { k: "Account no", v: maskAcct(loan.bank_account_no), copy: loan.bank_account_no },
    { k: "IFSC code", v: loan.bank_ifsc, copy: loan.bank_ifsc },
    { k: "Type", v: loan.bank_account_type },
  ];
  const fillOf = (...cols: FieldRow[][]) => { const f = fieldFill(...cols); return <FillCount have={f.have} total={f.total} />; };
  const checksCounted = checks.filter((c) => c.status !== "na");
  const checksOk = checksCounted.filter((c) => c.status === "pass").length;

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
            {editItems.length > 0 && <DownloadMenu label="Edit" icon={I.edit} items={editItems} />}
            <KebabMenu items={kebabItems} ghost />
          </div>
        </div>
        {/* Status lines: the last action, an abort, or ONE rejection reason
            (per-lender rows de-duplicated by text; the app-level reason is the
            fallback; hidden once a lender approves). */}
        {(() => {
          const lines: Array<{ key: string; text: string; red?: boolean }> = [];
          if (statusMsg && !rejected) lines.push({ key: "msg", text: statusMsg });
          if (aborted && loan.abort_reason) lines.push({ key: "abort", text: `Aborted — ${loan.abort_reason}`, red: true });
          const lenderRej = loan.status !== "approved"
            ? lenderRows.filter((r) => r.rejected_at && (r.rejection_reason ?? "").trim())
            : [];
          if (lenderRej.length > 0) {
            const seen = new Set<string>();
            lenderRej.forEach((r) => {
              const k = (r.rejection_reason ?? "").trim().toLowerCase();
              if (seen.has(k)) return;
              seen.add(k);
              lines.push({ key: r.id, text: `Rejection reason${r.lender_label ? ` (${r.lender_label})` : ""}: ${r.rejection_reason}`, red: true });
            });
          } else if (rejected && loan.rejection_reason) {
            lines.push({ key: "rej", text: `Rejection reason: ${loan.rejection_reason}`, red: true });
          }
          if (!lines.length) return null;
          return (
            <div className="w-full px-5 sm:px-8 pb-3 -mt-1 space-y-0.5">
              {lines.map((l) => (
                <div key={l.key} className={["text-[12.5px]", l.red ? "font-medium text-red-700" : "text-[#7a958a]"].join(" ")}>{l.text}</div>
              ))}
            </div>
          );
        })()}
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
              <div className="grid gap-x-6 gap-y-4 pt-6 xl:grid-cols-2 items-start">
                <div className="flex flex-col gap-4 min-w-0">
                  <Section card dropdown inline={stacked} icon={I.users} title="Identity" summary={fillOf(applicantRows, coappRows)}>
                    <div className="grid gap-x-12 gap-y-6 md:grid-cols-2 xl:grid-cols-1">
                      <FieldCol title="Applicant" rows={applicantRows} />
                      <FieldCol title="Co-applicant" rows={coappRows}>
                        {!hasCoapp && <p className="text-[14px] text-[#9aa5a0] py-[5px]">No co-applicant</p>}
                      </FieldCol>
                    </div>
                  </Section>

                  <Section card dropdown inline={stacked} icon={I.building} title="Installation site" summary={fillOf(siteRows)}>
                    <FieldCol title="Installation site" rows={siteRows} />
                  </Section>

                  <Section card dropdown inline={stacked} icon={I.money} title="Loan requirement" summary={fillOf(loanRows)}>
                    <FieldCol title="Loan requirement" rows={loanRows} />
                  </Section>

                  <Section card dropdown inline={stacked} icon={I.briefcase} title="Employment" summary={fillOf(employmentRows)}>
                    <FieldCol title="Employment" rows={employmentRows} />
                  </Section>

                  <Section card dropdown inline={stacked} icon={I.bank} title="Bank details" summary={fillOf(bankRows)}>
                    <FieldCol title="Bank details" rows={bankRows} />
                  </Section>

                  <Section card dropdown inline={stacked} icon={I.circleCheck} title="Checks" summary={<FillCount have={checksOk} total={checksCounted.length} />}>
                    <ChecksPanel items={checks} extra={dupList ? { dup: dupList } : undefined} />
                  </Section>
                </div>

                <div className="flex flex-col gap-4 min-w-0">
                  <Section card white icon={I.files} title="Documents" summary={<FillCount have={docsHave} total={checklist.length} />}>
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
                  </Section>
                </div>
              </div>
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
                            <span className="text-[#5a8a76]">{fmtApproval(d?.approved_loan_amount, true)}</span>
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
                {formFor && !aborted ? (
                  <>
                    {!approvedPlus && canAct && (
                      <div className="flex justify-end gap-2 pt-5">
                        <HAction variant="reject" disabled={statusBusy} onClick={() => setRejectOpen(true)}>Rejected by lender</HAction>
                      </div>
                    )}
                    <LoanApprovalForm
                      key={`${formFor.key}:${formEdit ?? "new"}`}
                      loan={loan}
                      lender={formFor.key}
                      lenderLabel={formFor.label}
                      editMode={formEdit}
                      hasSanctionLetter={hasCat("sanction_letter")}
                      onSaved={() => { setFormLender(null); setReloadKey((k) => k + 1); }}
                      onCancel={formLender ? () => setFormLender(null) : undefined}
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
      <DeleteLoanAppModal
        open={delOpen}
        onClose={() => setDelOpen(false)}
        onDeleted={() => { invalidate("dash.apps"); invalidate("dashkpis"); router.replace("/admin" as any); }}
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
    <span className={["shrink-0 inline-flex px-2.5 py-0.5 rounded-full border text-[12px] font-medium whitespace-nowrap", cls].join(" ")}>
      {label}
    </span>
  );
}
