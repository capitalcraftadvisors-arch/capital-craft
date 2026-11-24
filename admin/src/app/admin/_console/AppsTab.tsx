"use client";

// Admin console — Loan applications tab: every loan file with its admin stage,
// documents count, amount, disbursement countdown, lender email + EPC messages,
// the CSV list and the Excel reports.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import Modal, { OVERLAY } from "@/components/ui/Modal";
import AddNewLoanAppModal from "@/components/AddNewLoanAppModal";
import { ACCENTS } from "@/components/AdminSidebar";
import { supabase } from "@/lib/supabase";
import { authHeaders } from "@/lib/auth";
import { saveDownload } from "@/lib/storage";
import { lenderOutcome, OUTCOME_LABEL, OUTCOME_PILL } from "@/lib/loan-status";
import { getCached, setCached } from "@/lib/list-cache";
import { invalidateLoanBoards } from "@/lib/ops-board";
import { TRANCHE2_COLS, publishTranche2, tranche2Of, type Tranche2 } from "@/lib/tranche2";
import { isUndefinedColumn } from "@/lib/optional-column";
import { useAdminNames } from "@/lib/use-admin-names";
import { useEpcUpdates } from "@/lib/use-epc-updates";
import EmailComposerModal from "@/components/EmailComposerModal";
import RowLink from "@/components/RowLink";
import { notify } from "@/lib/notify";
import { nameCase, initialsOf } from "@/lib/names";
import {
  deadlineState, DEADLINE_PILL, firstDisbursedShown, FIRST_CHARGE_COLS,
  displayAmount as amountFor,
} from "@/lib/disbursement";
import { fmtRupees } from "@/lib/money";
import { fmtDate, fmtDateTime, localIsoDate } from "@/lib/dates";
import { DownloadMenu } from "@/components/ProfileTabBar";
import { latestLenderStatus, latestStatusLabel, lenderLabelIn, type LoanLenderRow } from "@/lib/loan-lenders";
import { useLenders } from "@/lib/lenders";
import { loanDocChecklist } from "@/lib/loan-doc-checklist";
import { inPeriod, usePeriodRows, type TabPeriodProps } from "./console-period";
import type { KpiRow } from "./DashboardKpis";
import {
  DateRange, EmptyRow, FiltersPanel, IconDownload, ListToolbar, PILL, SummaryCards, UnseenBadge,
  createdRange, downloadCsv, fmtAddedTime, highlightRowStyle, nameOptions, useRestoredFilters, useReturnHighlight,
  type EpcBusinessRef, type SummaryCard,
} from "./kit";

// Loan Status-column pills with a fixed label. Aborted is the inactive grey, so
// it can't be mistaken for a rejection.
const LOAN_PILL: Record<string, { label: string; cls: string }> = {
  aborted:         { label: "Aborted",               cls: "bg-grey-line text-[#64748b]" },
  draft:           { label: "Draft",                 cls: "bg-cc-chip text-cc-muted" },
  docs_sent:       { label: "Docs Sent",             cls: "bg-cc-blue-tint text-cc-blue" },
  hold:            { label: "Hold",                  cls: "bg-[#e5edf5] text-[#3b5a76]" },
  fully_disbursed: { label: "Fully Disbursed",       cls: "bg-cc-tint text-cc-green-text" },
  tranche1:        { label: "1st Disbursement Done", cls: "bg-cc-blue-tint text-cc-blue" },
};

// Per-application lender maps from each row's embedded lender rows: the latest
// lender status label (6h), the most-recent docs_sent_at ("Sent <date>") and
// every lender the file went to (Lender filter).
function lenderMaps(rows: { id: string; lenders?: LoanLenderRow[] | null }[]) {
  const lenderLatest: Record<string, string> = {};
  const lenderSentAt: Record<string, string> = {};
  const lenderKeys: Record<string, string[]> = {};
  for (const r of rows) {
    const appRows = r.lenders ?? [];
    if (!appRows.length) continue;
    const label = latestStatusLabel(latestLenderStatus(appRows));
    if (label) lenderLatest[r.id] = label;
    const latestSent = appRows.reduce<string | null>(
      (acc, x) => (x.docs_sent_at && (!acc || x.docs_sent_at > acc) ? x.docs_sent_at : acc), null);
    if (latestSent) lenderSentAt[r.id] = latestSent;
    lenderKeys[r.id] = appRows.map((x) => x.lender_key);
  }
  return { lenderLatest, lenderSentAt, lenderKeys };
}

export default function AppsTab({ period, pFrom, pTo, onRows }: TabPeriodProps & { onRows?: (rows: KpiRow[]) => void }) {
  const router = useRouter();
  type Row = {
    id: string;
    // Borrower fallback chain: borrower_name → aadhaar_name (Step 2 KYC) → "—".
    borrower_name: string | null;
    aadhaar_name:  string | null;
    borrower_pan: string | null;
    borrower_mobile: string | null;
    borrower_father_name: string | null;
    loan_display_id: string | null;
    // Loan amount lives in loan_amount_required (Step 3). loan_amount is
    // the legacy 0001 column — read both, prefer the newer one.
    loan_amount: number | null;
    loan_amount_required: number | null;
    // Disbursement (migration 0044). sanctioned_amount replaces the applied
    // amount in the Amount column once the loan is approved.
    sanctioned_amount: number | null;
    first_disbursement_amount: number | null;
    first_disbursement_date: string | null;
    second_disbursement_amount: number | null;
    // The lender's 1st-disbursement charges (0111) — Credit Fair's shown amount adds them.
    first_processing_fee?: number | null; first_legal_charges?: number | null; first_cersai_charges?: number | null;
    status: string; created_at: string; created_by: string; created_by_user_id: string | null;
    reviewed_at: string | null;
    aborted_at: string | null;
    // Application-doc presence for the "x/y docs" badge. Applicant PAN is a
    // user_application_docs row (`docs` below); the rest are *_path columns or
    // docs rows. Co-applicant docs only required when there is a co-applicant.
    aadhaar_front_path: string | null;
    aadhaar_back_path: string | null;
    ebill_path: string | null;
    proforma_invoice_path: string | null;
    rooftop_photo_path: string | null;
    bank_statement_path: string | null;
    customer_photo_path: string | null;
    // false = a co-applicant was added (its docs then become required).
    bill_on_applicant_name: boolean | null;
    // off_grid → the electricity bill isn't required (lib/loan-doc-checklist).
    system_type: string | null;
    aadhaar_face_path: string | null;
    // user_application_docs categories (embedded in the list query) — a document
    // uploaded as a row counts the same as its *_path column.
    docs?: { category: string }[] | null;
    coapp_pan_path: string | null;
    coapp_aadhaar_front_path: string | null;
    coapp_aadhaar_back_path: string | null;
    // Which lender decided — powers the Lender filter (display/filter only).
    approved_lender: string | null;
    rejected_lender: string | null;
    // "Message to EPC" attention (0082) — for the "EPC updates" notice.
    attention_status: string | null;
    attention_resolved_at: string | null;
    epc_last_activity_at: string | null;
    msg_admin_seen_at: string | null;
    epc_business: EpcBusinessRef;
    // This file's lender rows (loan_application_lenders, embedded in the list
    // query — timeline columns only) → status label, "Sent <date>", Lender filter.
    lenders?: LoanLenderRow[] | null;
  };
  const adminNames = useAdminNames();
  const { loanCounts } = useEpcUpdates();   // per-admin unseen EPC-reply counts
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false); // first read done (cache or query)
  // From each row's lender rows: 6h — the latest lender status label; the latest
  // docs-sent (email-to-lender) time for the "Sent <date>" line under the status
  // pill; every lender the file went to — for the Lender filter.
  const { lenderLatest, lenderSentAt, lenderKeys } = useMemo(() => lenderMaps(rows), [rows]);
  // The loaded list also feeds the KPI strip (DashboardKpis) — no query of its own.
  useEffect(() => { if (loaded) onRows?.(rows); }, [rows, loaded, onRows]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  // Client-side filters over the already-loaded list.
  const [epcFilter, setEpcFilter]       = useState("");
  const lenders = useLenders();
  const [lenderFilter, setLenderFilter] = useState("");
  // Created-date range (inclusive) via calendar pickers.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Table sort: newest-created first by default; the Days-remaining header
  // toggles to fewest-days-first.
  const [sortKey, setSortKey] = useState<"created" | "days">("created");
  const [addOpen, setAddOpen] = useState(false);
  // Row whose "send to lender" email composer is open (replaces the old
  // Download-ZIP action — ZIP still lives on the loan View page).
  const [emailRow, setEmailRow] = useState<Row | null>(null);
  // Row highlighted after returning from View (scroll restored too) — same
  // behaviour as the EPC list, with its own sessionStorage keys.
  const highlightId = useReturnHighlight("appsList.scroll", "appsList.lastRowId", rows.length);

  // Restore the filter/search/sort state saved by navigateToView, so
  // returning from a View lands on the same filtered list. Mount-only +
  // consumed immediately so a fresh visit is clean.
  useRestoredFilters("appsList.filters", (f) => {
    if (typeof f.q === "string") setQ(f.q);
    if (typeof f.statusFilter === "string") setStatusFilter(f.statusFilter);
    if (typeof f.epcFilter === "string") setEpcFilter(f.epcFilter);
    if (typeof f.lenderFilter === "string") setLenderFilter(f.lenderFilter);
    if (typeof f.dateFrom === "string") setDateFrom(f.dateFrom);
    if (typeof f.dateTo === "string") setDateTo(f.dateTo);
    if (typeof f.categoryFilter === "string") setCategoryFilter(f.categoryFilter);
    if (f.sortKey === "created" || f.sortKey === "days") setSortKey(f.sortKey);
    if (f.statusFilter || f.epcFilter || f.lenderFilter || f.dateFrom || f.dateTo || f.categoryFilter) {
      setFiltersOpen(true);
    }
  });

  // Save scroll + row id + the active tab + filters, then navigate to View.
  // The tab key is what brings Back to the Loan applications tab rather than EPCs.
  function navigateToView(row: Row) {
    sessionStorage.setItem("appsList.scroll", String(window.scrollY));
    sessionStorage.setItem("appsList.lastRowId", row.id);
    sessionStorage.setItem("adminList.tab", "apps");
    sessionStorage.setItem("appsList.filters", JSON.stringify({
      q, statusFilter, epcFilter, lenderFilter,
      dateFrom, dateTo, categoryFilter, sortKey,
    }));
    router.push(`/admin/app/${row.id}/view`);
  }

  // Loader — one request: the list with each file's lender rows embedded. A send
  // from the list patches the row locally (recordDocsSentFromList), no reload.
  const loadApps = useCallback(async () => {
    // Short per-tab cache (45s) so switching tabs / returning to the console
    // reuses the last result instead of re-querying — cuts Supabase egress.
    const CK = "dash.apps";
    const cached = getCached<{ rows: Row[] }>(CK, 45000);
    if (cached) { setRows(cached.rows); setLoaded(true); return; }
    const appsSel = (extra: string) => supabase()
      .from("epc_applications")
      .select(
        extra +
        "id, borrower_name, aadhaar_name, loan_display_id, " +
        "borrower_pan, borrower_mobile, borrower_father_name, " +
        "loan_amount, loan_amount_required, " +
        "sanctioned_amount, first_disbursement_amount, first_disbursement_date, second_disbursement_amount, " +
        `${FIRST_CHARGE_COLS}, ` +
        // NOTE: rfd_at is intentionally NOT selected — it doesn't exist until
        // migration 0059 is applied, and the dashboard doesn't need it (new
        // RFD rows carry status='rfd'; disbursed rows are detected by amount).
        "status, created_at, created_by, created_by_user_id, reviewed_at, aborted_at, approved_lender, rejected_lender, " +
        "aadhaar_front_path, aadhaar_back_path, ebill_path, proforma_invoice_path, " +
        "rooftop_photo_path, bank_statement_path, customer_photo_path, aadhaar_face_path, bill_on_applicant_name, system_type, " +
        // Doc categories in the SAME request (no extra query) for the docs badge.
        "docs:user_application_docs(category), " +
        // Per-lender timeline in the SAME request (6h status, "Sent <date>",
        // Lender filter) — only these columns; approval_details stays out.
        "lenders:loan_application_lenders(lender_key, lender_label, docs_sent_at, approved_at, rejected_at), " +
        "coapp_pan_path, coapp_aadhaar_front_path, coapp_aadhaar_back_path, " +
        "attention_status, attention_resolved_at, epc_last_activity_at, msg_admin_seen_at, " +
        "epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)",
      )
      .order("created_at", { ascending: false });
    // tranche2_* (0125) feed the bell's 2nd-tranche count — same request; until
    // 0125 is everywhere, retry without them.
    let res = await appsSel(`${TRANCHE2_COLS}, `);
    const hasT2 = !isUndefinedColumn(res.error, "tranche2_");
    if (!hasT2) res = await appsSel("");
    const rows = (res.data ?? []) as unknown as Row[];
    setRows(rows);
    setLoaded(true);
    if (hasT2 && !res.error) {
      publishTranche2(rows.map((r) => {
        const b = r.epc_business;
        return tranche2Of(r as unknown as Record<string, any>, r.aadhaar_name || r.borrower_name || "—",
          b?.trade_name || b?.legal_name || b?.contact_name || null);
      }).filter((t): t is Tranche2 => !!t));
    }
    setCached(CK, { rows });
  }, []);

  // Loads on open only (cached). No reload on tab focus — it re-downloaded the
  // whole list on every switch back to the portal and blew the Free-plan
  // egress; other admins' changes show on the next open after the cache ages.
  useEffect(() => { void loadApps(); }, [loadApps]);

  // After an email goes out from the LIST, record the shared docs-sent marker
  // (loan_application_lenders.docs_sent_at) — the same state the View page writes
  // via sendDocsToLender — so the status pill + "Sent <date>" show for EVERY
  // admin, not just the one who sent it. Previously the list send recorded
  // nothing, so another admin had no way to know it had already gone out.
  async function recordDocsSentFromList(app: Row, lenderKey: string) {
    const label = lenderLabelIn(lenders, lenderKey);
    const now = new Date().toISOString();
    // That lender's row as it stands after this send, and whether the headline
    // moved to Docs Sent — mirrored onto the list row below instead of a reload.
    let lenderRow: LoanLenderRow | null = null;
    let advanced = false;
    try {
      const { data: existing } = await supabase()
        .from("loan_application_lenders")
        .select("id, lender_key, lender_label, docs_sent_at, approved_at, rejected_at")
        .eq("application_id", app.id)
        .eq("lender_key", lenderKey)
        .maybeSingle();
      const ex = existing as unknown as LoanLenderRow | null;
      if (ex) {
        lenderRow = ex;
        if (!ex.docs_sent_at) {
          const { error } = await supabase().from("loan_application_lenders")
            .update({ docs_sent_at: now }).eq("id", ex.id);
          if (!error) lenderRow = { ...ex, docs_sent_at: now };
        }
      } else {
        const { error } = await supabase().from("loan_application_lenders")
          .insert({ application_id: app.id, lender_key: lenderKey, lender_label: label, docs_sent_at: now });
        if (!error) lenderRow = { lender_key: lenderKey, lender_label: label, docs_sent_at: now, approved_at: null, rejected_at: null } as LoanLenderRow;
      }
      // Advance the headline to Docs Sent only while still pre-decision, so this
      // never overrides an existing approval/rejection.
      if (["draft", "submitted", "under_review"].includes(String(app.status))) {
        const { error } = await supabase().from("epc_applications")
          .update({ status: "docs_sent", docs_sent_at: now }).eq("id", app.id);
        advanced = !error;
      }
    } catch { /* best-effort — the email already went; the marker is a convenience */ }
    // Also drops this list's cache (dash.apps), so the next open reads it fresh.
    invalidateLoanBoards(); // and the Task Manager board's; the KPI strip follows the patch below
    if (!lenderRow && !advanced) return;
    const lr = lenderRow;
    setRows((rs) => rs.map((r) => (r.id !== app.id ? r : {
      ...r,
      ...(advanced ? { status: "docs_sent" } : {}),
      ...(lr ? { lenders: [...(r.lenders ?? []).filter((x) => x.lender_key !== lenderKey), lr] } : {}),
    })));
  }

  // Display helpers — encapsulated so the render below stays clean.
  // Prefer the KYC (Aadhaar) name — the verified applicant — so the list matches
  // the profile header. borrower_name can be a stale lead name (from a converted
  // lead), which made the list disagree with the opened profile.
  function displayBorrower(r: Row): string {
    return nameCase(r.aadhaar_name || r.borrower_name) || "—";
  }
  // Applications that look like the SAME person as another loan — flagged ⚠ so
  // duplicates get caught before double-work. A shared PAN or mobile is a
  // definitive match; a shared name is only flagged when the FATHER'S name also
  // matches (so two unrelated people with the same name aren't falsely flagged).
  const dupNorm = (s: string | null | undefined) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const dupNameKey = (r: Row) => {
    const nm = dupNorm(r.aadhaar_name || r.borrower_name), fn = dupNorm(r.borrower_father_name);
    return nm && fn ? `nf:${nm}|${fn}` : "";
  };
  const dupKeys = useMemo(() => {
    const count = new Map<string, number>();
    const bump = (k: string) => { if (k) count.set(k, (count.get(k) || 0) + 1); };
    for (const r of rows) {
      bump((r.borrower_pan || "").toUpperCase().trim());
      bump((r.borrower_mobile || "").trim());
      bump(dupNameKey(r));
    }
    return new Set([...count.entries()].filter(([, c]) => c > 1).map(([k]) => k));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);
  const isDup = (r: Row) => {
    const pan = (r.borrower_pan || "").toUpperCase().trim(); if (pan && dupKeys.has(pan)) return true;
    const mob = (r.borrower_mobile || "").trim(); if (mob && dupKeys.has(mob)) return true;
    const nf = dupNameKey(r); return !!nf && dupKeys.has(nf);
  };
  // Document completeness from the *_path columns plus the user_application_docs
  // categories embedded in the list query (r.docs — applicant PAN counts from
  // there). Co-applicant docs count only when a co-applicant exists
  // (bill_on_applicant_name === false).
  // Same rule as the loan profile's Doc Sent gate (lib/loan-doc-checklist).
  function docStat(r: Row): { have: number; need: number } {
    const all = loanDocChecklist(r, (r.docs ?? []).map((d) => d.category));
    return { have: all.filter((d) => d.ok).length, need: all.length };
  }
  function displayEpc(r: Row): string {
    return nameCase(r.epc_business?.trade_name
        || r.epc_business?.legal_name
        || r.epc_business?.contact_name) || "—";
  }
  // Created by — "EPC" for EPC-portal files, else the admin user who added it.
  const createdBy = (r: Row) =>
    r.created_by === "epc" ? "EPC" : r.created_by_user_id ? (adminNames.get(r.created_by_user_id) ?? "Admin") : "Admin";
  // Status-column pill. Once the 1st disbursement is entered it shows that
  // instead — display-only, the underlying status field is unchanged.
  function loanPill(r: Row): { label: string; cls: string } {
    if (r.aborted_at != null) return LOAN_PILL.aborted;
    if (r.status === "draft") return LOAN_PILL.draft;
    if (r.status === "docs_sent" && !lenderLatest[r.id]) return LOAN_PILL.docs_sent;
    if (r.status === "on_hold") return LOAN_PILL.hold;
    if (r.status === "approved" && r.first_disbursement_amount != null) {
      return r.second_disbursement_amount != null ? LOAN_PILL.fully_disbursed : LOAN_PILL.tranche1;
    }
    // Finalized for disbursement — the approval by that lender (not the latest
    // event, which may be a different lender's later rejection).
    if (r.approved_lender) {
      return { label: `Approved by ${lenderLabelIn(lenders, String(r.approved_lender))}`, cls: "bg-cc-tint text-cc-green-text" };
    }
    // Latest status across all lenders: a rejection is red, other events indigo.
    const latest = lenderLatest[r.id];
    if (latest) return { label: latest, cls: latest.startsWith("Rejected") ? "bg-red-50 text-red-700" : "bg-[#eef0fb] text-[#4338ca]" };
    const o = lenderOutcome(r.status);
    return { label: OUTCOME_LABEL[o], cls: OUTCOME_PILL[o] };
  }
  // Approved → show what the lender SANCTIONED; otherwise what was applied for.
  function displayAmount(r: Row): string {
    return fmtRupees(amountFor(r));
  }
  // EPC options for the filter dropdown — only EPCs actually present in the list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const epcOptions = useMemo(() => nameOptions(rows, displayEpc), [rows]);

  // Client-side filter, then sort: rows with a RUNNING disbursement countdown
  // first (fewest days remaining on top — overdue is negative, so it floats to
  // the very top), everything else below, newest first. The query is untouched.
  // One mutually-exclusive admin stage per application (drives the period
  // summary cards + click-to-filter). EPC-facing surfaces still use lenderOutcome(), so
  // docs_sent / on_hold never leak to EPCs (both read as "Under Review" there).
  function loanStage(r: Row): string {
    if (r.aborted_at != null) return "aborted";
    const s = r.status;
    if (s === "draft") return "draft";
    if (s === "on_hold") return "hold";
    if (s === "docs_sent") {
      // A lender can REJECT after docs were sent while the headline status
      // stays "docs_sent" (the rejection lives on loan_application_lenders, not
      // the app row). Match the Status pill, which already reads lenderLatest:
      // if the latest lender event is a rejection and nothing has since approved
      // it, the stage is "rejected" — so a rejected file no longer leaks into
      // the "Docs Sent" filter or its card.
      if (!r.approved_lender && lenderLatest[r.id]?.startsWith("Rejected")) return "rejected";
      return "docs_sent";
    }
    if (s === "rejected") return "rejected";
    if (s === "rfd" || s === "approved" || s === "sent_to_nbfc" || s === "disbursed") {
      if (r.first_disbursement_amount != null) return "disbursed";
      if (s === "rfd") return "rfd";   // Ready for Disbursement
      return "approved";
    }
    return "under_review"; // submitted / under_review / anything pre-decision
  }
  // Card category predicate — shared by the card counts AND click-to-filter.
  function catMatch(r: Row, key: string): boolean {
    switch (key) {
      case "unseen":       return loanStage(r) === "draft"; // Application Unseen = Draft
      case "under_review": return loanStage(r) === "under_review";
      case "docs_sent":    return loanStage(r) === "docs_sent";
      case "hold":         return loanStage(r) === "hold";
      case "approved":     return loanStage(r) === "approved";
      case "rfd":          return loanStage(r) === "rfd";
      case "disbursed":    return loanStage(r) === "disbursed";
      case "rejected":     return loanStage(r) === "rejected";
      case "aborted":      return loanStage(r) === "aborted";
      default:             return true;
    }
  }
  // Filters-panel "Status" predicate (Draft / Under Review / Docs Sent / Hold /
  // Approved / Rejected by lender / 1st & 2nd Tranche Done). Every bucket is
  // mutually exclusive and driven off loanStage() so the filter matches what the
  // row's Status column actually shows. Aborted rows only ever match "aborted" —
  // an aborted draft/approved/rejected does NOT leak into those filters.
  function statusMatch(r: Row, key: string): boolean {
    if (key === "aborted") return r.aborted_at != null;
    if (r.aborted_at != null) return false; // aborted belongs only to the Aborted filter
    switch (key) {
      case "draft":        return loanStage(r) === "draft";
      case "under_review": return loanStage(r) === "under_review";
      case "docs_sent":    return loanStage(r) === "docs_sent";
      case "hold":         return loanStage(r) === "hold";
      case "approved":     return loanStage(r) === "approved"; // approved only — not RFD/disbursed
      case "rfd":          return loanStage(r) === "rfd";
      case "rejected":     return loanStage(r) === "rejected";
      case "tranche1":     return r.first_disbursement_amount != null && r.second_disbursement_amount == null;
      case "tranche2":     return r.second_disbursement_amount != null;
      default:             return true;
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const inRange = createdRange(dateFrom, dateTo);

    const out = rows.filter((r) => {
      if (!inPeriod(r.created_at, period, pFrom, pTo)) return false; // period drives the list too
      if (categoryFilter && !catMatch(r, categoryFilter)) return false;
      if (statusFilter && !statusMatch(r, statusFilter)) return false;
      if (needle &&
          !(displayBorrower(r).toLowerCase().includes(needle) ||
            (r.borrower_mobile ?? "").includes(needle) ||
            (r.loan_display_id ?? "").toLowerCase().includes(needle) ||
            displayEpc(r).toLowerCase().includes(needle))) return false;
      if (epcFilter && displayEpc(r) !== epcFilter) return false;
      // Lender: the final lender once approved; before that, every lender the
      // file went to — so "Docs Sent + Credit Fair" finds the files sent there.
      if (lenderFilter && !(r.approved_lender
        ? r.approved_lender === lenderFilter
        : r.rejected_lender === lenderFilter || (lenderKeys[r.id] ?? []).includes(lenderFilter))) return false;
      return inRange(r.created_at);
    });

    // Default: newest created first. Days-remaining header → fewest days first
    // (running disbursement countdowns; non-approved rows sink to the bottom).
    if (sortKey === "days") {
      return out.sort((a, b) => {
        const ra = a.status === "approved" && !!a.first_disbursement_date;
        const rb = b.status === "approved" && !!b.first_disbursement_date;
        if (ra !== rb) return ra ? -1 : 1;
        if (ra && rb) {
          return deadlineState(a.first_disbursement_date, a.second_disbursement_amount != null).daysRemaining
               - deadlineState(b.first_disbursement_date, b.second_disbursement_amount != null).daysRemaining;
        }
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    }
    // EPC-updated profiles float up — per admin: only until THIS admin opens it.
    const upd = (r: Row) => (loanCounts.get(r.id) ?? 0) > 0;
    return out.sort((a, b) => {
      const au = upd(a) ? 1 : 0, bu = upd(b) ? 1 : 0;
      if (au !== bu) return bu - au;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, categoryFilter, statusFilter, epcFilter, lenderFilter, lenderKeys, dateFrom, dateTo, sortKey, period, pFrom, pTo, loanCounts]);

  const periodRows = usePeriodRows(rows, period, pFrom, pTo);
  const cards: SummaryCard[] = [
    { key: "",             label: "Total Applications", value: periodRows.length },
    { key: "unseen",       label: "Application Unseen", value: periodRows.filter((r) => catMatch(r, "unseen")).length },
    { key: "under_review", label: "Under Review",       value: periodRows.filter((r) => catMatch(r, "under_review")).length },
    { key: "docs_sent",    label: "Docs Sent",          value: periodRows.filter((r) => catMatch(r, "docs_sent")).length },
    { key: "approved",     label: "Approved",           value: periodRows.filter((r) => catMatch(r, "approved")).length },
    { key: "rfd",          label: "RFD",                value: periodRows.filter((r) => catMatch(r, "rfd")).length },
    { key: "disbursed",    label: "Disbursed",          value: periodRows.filter((r) => catMatch(r, "disbursed")).length },
    { key: "rejected",     label: "Rejected",           value: periodRows.filter((r) => catMatch(r, "rejected")).length },
    // Hold and Aborted are no longer cards — they live in the Status filter.
  ];
  const panelActive = [statusFilter, epcFilter, lenderFilter, dateFrom, dateTo].filter(Boolean).length;
  const activeCount = panelActive + (categoryFilter ? 1 : 0);
  const pickCategory = (key: string) => setCategoryFilter(key === categoryFilter ? "" : key);
  function clearAll() {
    setStatusFilter(""); setEpcFilter(""); setLenderFilter("");
    setDateFrom(""); setDateTo(""); setCategoryFilter("");
  }

  // "Report" — client-side CSV export of the CURRENTLY-FILTERED list.
  function exportReport() {
    const STAGE: Record<string, string> = {
      draft: "Draft", under_review: "Under Review", docs_sent: "Docs Sent", hold: "Hold",
      approved: "Approved", rfd: "RFD", disbursed: "Disbursed", rejected: "Rejected", aborted: "Aborted",
    };
    const header = ["Loan ID", "Borrower", "EPC partner", "Amount", "Stage", "Docs", "Created on", "Created by", "1st disbursement", "2nd disbursement"];
    const rows = filtered.map((r) => {
      const d = docStat(r);
      return [
        r.loan_display_id || r.id,
        displayBorrower(r),
        displayEpc(r),
        amountFor(r),
        STAGE[loanStage(r)] ?? loanStage(r),
        `${d.have}/${d.need}`,
        fmtDateTime(r.created_at),
        createdBy(r),
        r.first_disbursement_amount ?? "",
        r.second_disbursement_amount ?? "",
      ];
    });
    downloadCsv("loan-applications", header, rows);
  }

  // The Excel reports (api/admin/loan-reports): lender-wise disbursements of a
  // month, and the 2nd tranche still pending. One request per download.
  const [reportBusy, setReportBusy] = useState<string | null>(null);
  const [monthPick, setMonthPick] = useState<string | null>(null); // YYYY-MM while the month popup is open
  async function downloadLoanReport(type: "monthly" | "pending", month?: string) {
    setReportBusy("Preparing…");
    try {
      const qs = type === "monthly" ? `type=monthly&month=${month}` : "type=pending";
      const res = await fetch(`/api/admin/loan-reports?${qs}`, { headers: authHeaders() });
      if (!res.ok) { const j = await res.json().catch(() => ({})); notify.error(j?.error || "Couldn't build the report."); return; }
      await saveDownload(res, "report.xlsx");
    } finally {
      setReportBusy(null);
    }
  }


  return (
    <>
      <SummaryCards accent={ACCENTS.apps.color} cards={cards} active={categoryFilter} onPick={pickCategory} />

      {/* Report → "Lender-wise disbursements": which month. */}
      {monthPick !== null && (
        <Modal onClose={() => setMonthPick(null)} overlayClassName={OVERLAY.grid} className="w-full max-w-sm bg-white rounded-xl shadow-lg p-6 space-y-4" aria-label="Lender-wise disbursements">
          <h3 className="text-[17px] font-semibold text-cc-ink">Lender-wise disbursements</h3>
          <label className="block">
            <span className="block mb-1 text-[12.5px] text-cc-muted">Month</span>
            <input type="month" value={monthPick} max={localIsoDate(new Date()).slice(0, 7)} onChange={(e) => setMonthPick(e.target.value)}
              className="w-full border border-line rounded-input px-3 py-2 text-[14px] focus:outline-none focus:border-cc-green" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setMonthPick(null)} className="px-4 py-2 rounded-[8px] border border-line text-[13px] text-text-mid hover:bg-bg-soft">Cancel</button>
            <button type="button" disabled={!monthPick}
              onClick={() => { const m = monthPick; setMonthPick(null); void downloadLoanReport("monthly", m); }}
              className="px-4 py-2 rounded-[8px] bg-cc-green text-white text-[13px] font-semibold hover:bg-cc-green-hover disabled:opacity-50">
              Download
            </button>
          </div>
        </Modal>
      )}

      <ListToolbar placeholder="Search by borrower or mobile…" q={q} onQ={setQ}
        accent={ACCENTS.apps.color} filterCount={activeCount} filtersOpen={filtersOpen} onToggleFilters={() => setFiltersOpen((o) => !o)}>
        <DownloadMenu
          outline
          label="Report"
          icon={IconDownload}
          busyLabel={reportBusy}
          disabled={!!reportBusy}
          items={[
            { label: "Loan list", onClick: exportReport },
            { label: "Lender-wise disbursements (monthly)", onClick: () => setMonthPick(localIsoDate(new Date()).slice(0, 7)) },
            { label: "2nd tranche pending", onClick: () => void downloadLoanReport("pending") },
          ]}
        />
        <Button variant="primary" onClick={() => setAddOpen(true)} style={{ backgroundColor: ACCENTS.apps.color }} className="whitespace-nowrap">
          + New Applicant
        </Button>
      </ListToolbar>

      <FiltersPanel open={filtersOpen} hasActive={activeCount > 0} onClear={clearAll}>
        <Select
          label="Status"
          placeholder="Select Status"
          options={[
            { value: "draft",        label: "Draft" },
            { value: "under_review", label: "Under Review" },
            { value: "docs_sent",    label: "Docs Sent" },
            { value: "hold",         label: "Hold" },
            { value: "approved",     label: "Approved by lender" },
            { value: "rfd",          label: "RFD (Ready for Disbursement)" },
            { value: "rejected",     label: "Rejected by lender" },
            { value: "aborted",      label: "Aborted" },
            { value: "tranche1",     label: "1st Tranche Done" },
            { value: "tranche2",     label: "2nd Tranche Done" },
          ]}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        />
        <Select
          label="EPC Name"
          placeholder="EPC"
          options={epcOptions}
          value={epcFilter}
          onChange={(e) => setEpcFilter(e.target.value)}
        />
        <Select
          label="Lender"
          placeholder="Lender"
          options={lenders.map((l) => ({ value: l.key, label: l.label }))}
          value={lenderFilter}
          onChange={(e) => setLenderFilter(e.target.value)}
        />
        <DateRange from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} />
      </FiltersPanel>

      <Card className="overflow-hidden cc-table-card">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-[14px] table-fixed cc-table">
          {/* Percentage widths — the table fills the page evenly and scrolls sideways
              only on small screens. */}
          <colgroup>
            <col style={{ width: "23%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "10%" }} />
          </colgroup>
          {/* Everything centred except Borrower, which stays left. */}
          <thead>
            <tr>
              <th className="px-4 py-3 font-medium text-[11.5px] uppercase tracking-wide text-left">Borrower</th>
              <th className="px-3 py-3 font-medium text-[11.5px] uppercase tracking-wide text-center">EPC partner</th>
              <th className="px-3 py-3 font-medium text-[11.5px] uppercase tracking-wide text-center">Amount</th>
              <th className="px-3 py-3 font-medium text-[11.5px] uppercase tracking-wide text-center">Status</th>
              <th className="px-3 py-3 font-medium text-[11.5px] uppercase tracking-wide text-center">
                <button type="button" onClick={() => setSortKey((k) => (k === "days" ? "created" : "days"))} className="inline-flex items-center gap-1 uppercase tracking-wide" title="Sort by fewest days remaining">
                  Disbursement
                  <span className={sortKey === "days" ? "opacity-100" : "opacity-30"}>↑</span>
                </button>
              </th>
              <th className="px-3 py-3 font-medium text-[11.5px] uppercase tracking-wide text-center">Created</th>
              <th className="px-3 py-3 font-medium text-[11.5px] uppercase tracking-wide text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <EmptyRow cols={7} loaded={loaded} hasRows={rows.length > 0} noun="applications" />
            ) : filtered.map((r) => {
              const isHighlighted = highlightId === r.id;
              const d = docStat(r);
              const unseen = loanCounts.get(r.id) ?? 0;
              return (
              <tr
                key={r.id}
                data-highlighted={isHighlighted ? "yes" : undefined}
                style={highlightRowStyle(isHighlighted)}
                onClick={() => navigateToView(r)}
                className="border-b border-cc-rule last:border-b-0 cursor-pointer hover:bg-cc-row-hover transition-colors"
              >
                {/* Borrower: initials + name + loan ID · documents */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="w-9 h-9 rounded-full bg-[var(--acc-tint)] text-[var(--acc)] grid place-items-center shrink-0 text-[12.5px] font-semibold">
                      {initialsOf(displayBorrower(r))}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-semibold text-cc-ink truncate flex items-center gap-1">
                        <RowLink href={`/admin/app/${r.id}/view`} onOpen={() => navigateToView(r)} className="truncate">{displayBorrower(r)}</RowLink>
                        {isDup(r) && <span title="Same person as another application — matches on PAN / mobile, or name + father's name — possible duplicate" className="text-[#d97706] shrink-0">⚠</span>}
                      </p>
                      <p className="text-[11.5px] mt-0.5 flex items-center gap-1.5 min-w-0">
                        {r.loan_display_id && <span className="font-mono text-cc-blue truncate">{r.loan_display_id}</span>}
                        <span
                          title={d.have >= d.need ? "All documents uploaded" : "Some documents still pending"}
                          className={["shrink-0 font-semibold tabular-nums", d.have >= d.need ? "text-cc-green" : "text-[#d4900f]"].join(" ")}
                        >
                          {r.loan_display_id ? "· " : ""}{d.have}/{d.need} docs
                        </span>
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-center">
                  <p className="text-[13px] text-cc-ink truncate">{displayEpc(r)}</p>
                </td>
                <td className="px-3 py-3 text-center">
                  {(() => {
                    const applied = r.loan_amount_required ?? r.loan_amount;
                    const shown = amountFor(r);
                    const differs = applied != null && shown != null && Number(applied) !== Number(shown);
                    const over = differs && Number(shown) > Number(applied);
                    return (
                      <>
                        <p className={["text-[13px] font-semibold", over ? "text-red-700" : "text-cc-ink"].join(" ")}>{displayAmount(r)}</p>
                        {differs && <p className={["text-[11px] mt-0.5", over ? "text-red-700" : "text-cc-faint"].join(" ")}>Applied {fmtRupees(applied)}</p>}
                      </>
                    );
                  })()}
                </td>
                {/* Status pill — display-only, the underlying status is unchanged. */}
                <td className="px-3 py-3 text-center">
                  {(() => { const p = loanPill(r); return <span className={`${PILL} ${p.cls}`}>{p.label}</span>; })()}
                </td>
                {/* Disbursement: amount + date, and the countdown once approved. */}
                <td className="px-3 py-3 text-center">
                  {r.status !== "approved" ? (
                    <span className="text-[13px] text-[#b4bdb9]">—</span>
                  ) : (
                    <>
                      {r.first_disbursement_amount != null && (
                        <>
                          <p className="text-[13px] font-semibold text-cc-ink">{fmtRupees(firstDisbursedShown(r))}</p>
                          <p className="text-[11px] text-cc-faint mt-0.5">{fmtDate(r.first_disbursement_date)}</p>
                        </>
                      )}
                      {(() => {
                        const dl = deadlineState(r.first_disbursement_date, r.second_disbursement_amount != null);
                        return (
                          <span className={["inline-block mt-1 px-2 py-0.5 rounded-[6px] text-[11px] font-semibold whitespace-nowrap", DEADLINE_PILL[dl.tone]].join(" ")}>
                            {dl.label}
                          </span>
                        );
                      })()}
                    </>
                  )}
                </td>
                {/* Created — date, then time · who. */}
                <td className="px-3 py-3 text-center">
                  <p className="text-[13px] font-medium text-cc-ink">{fmtDate(r.created_at)}</p>
                  <p className="text-[11px] text-cc-faint mt-0.5 truncate">
                    {fmtAddedTime(r.created_at)} · {createdBy(r)}
                  </p>
                </td>
                {/* Action: email to lender + message to EPC (this admin's unseen
                    replies). stopPropagation so they don't also open the row. */}
                <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                  <div className="inline-flex flex-col items-center gap-1">
                    <div className="inline-flex items-center justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEmailRow(r)}
                        title="Email to lender"
                        aria-label="Email to lender"
                        className="grid place-items-center w-8 h-8 rounded-[8px] border border-cc-line bg-white text-cc-green hover:bg-cc-wash hover:border-cc-green transition-colors"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push(`/admin/app/${r.id}/messages`)}
                        title="Message to EPC"
                        aria-label="Message to EPC"
                        className="relative grid place-items-center w-8 h-8 rounded-[8px] border border-cc-line bg-white text-cc-green hover:bg-cc-wash hover:border-cc-green transition-colors"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        <UnseenBadge n={unseen} />
                      </button>
                    </div>
                    {/* When the documents were last emailed to a lender. */}
                    {r.aborted_at == null && lenderSentAt[r.id] && (
                      <p className="text-[11px] text-cc-faint whitespace-nowrap">Sent {fmtDate(lenderSentAt[r.id])}</p>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </Card>

      <AddNewLoanAppModal open={addOpen} onClose={() => setAddOpen(false)} />

      {/* Send-to-lender email composer — same shared modal + preview/send flow
          the loan View page uses (editable subject/detail, CC/BCC, attachments). */}
      <EmailComposerModal
        open={!!emailRow}
        onClose={() => setEmailRow(null)}
        endpoint={emailRow ? `/api/admin/loan-app/${emailRow.id}/send-to-lender` : ""}
        title="Send to lender"
        defaultLender={emailRow?.approved_lender}
        onSent={(lenderKey) => { const app = emailRow; if (app) void recordDocsSentFromList(app, lenderKey); }}
      />
    </>
  );
}
