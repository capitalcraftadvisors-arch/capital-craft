// Server-only. The Claude connector's (MCP) READ-ONLY tools over portal data.
//
// Every query runs through RLS with a short-lived mcp_reader JWT (migration
// 0095): SELECT-only at the database, scoped to what the connector's owner
// (the main admin) may see. No tool writes anything. Aadhaar / PAN / bank
// numbers are never returned. Dates are DD/MM/YYYY (India time); amounts are
// exact rupees.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtDateIST as dt } from "./dates";
import { remainingAmount, firstCharges, FIRST_CHARGE_COLS } from "./disbursement";
import { PENDING_FILTER } from "./review";
import { DEFAULT_LOAN_LENDERS, lenderLabelIn } from "./loan-lenders";

type Args = Record<string, unknown>;
type Row = Record<string, any>;
export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (db: SupabaseClient, args: Args) => Promise<unknown>;
};

// ── helpers ──────────────────────────────────────────────────────────────
const str = (v: unknown) => (typeof v === "string" ? v : "");
// Search text safe for a PostgREST or() filter (letters, digits, space, - /).
const clean = (v: unknown) => str(v).replace(/[^\p{L}\p{N} \-/]/gu, "").trim().slice(0, 60);
const limitOf = (v: unknown) => Math.min(200, Math.max(1, Math.floor(Number(v) || 50)));
const lender = (k: unknown) => (k ? lenderLabelIn(DEFAULT_LOAN_LENDERS, String(k)) : null);
const epcName = (b: Row | null | undefined) => b?.trade_name || b?.legal_name || b?.contact_name || null;
const num = (v: unknown) => (v == null ? null : Number(v));

const PERIODS = ["today", "this_month", "last_month", "this_quarter", "this_fy", "last_fy", "all"] as const;
const periodProp = {
  period: { type: "string", enum: PERIODS, description: "Created-date window in India time (FY = April–March). Default: all." },
  from: { type: "string", description: "Custom start date YYYY-MM-DD (overrides period)." },
  to: { type: "string", description: "Custom end date YYYY-MM-DD, inclusive." },
};

// [start, end) instants for a period / custom range, in India time.
function range(args: Args): { from: Date | null; to: Date | null; label: string } {
  const ist = (iso: string) => new Date(`${iso}T00:00:00+05:30`);
  const p2 = (n: number) => String(n).padStart(2, "0");
  const ymd = (y: number, m: number, d: number) => { const x = new Date(Date.UTC(y, m - 1, d)); return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}`; };
  const f = str(args.from), t = str(args.to);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f) || /^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const [ty, tm, td] = (t || "9999-12-30").split("-").map(Number);
    return { from: f ? ist(f) : null, to: t ? ist(ymd(ty, tm, td + 1)) : null, label: `${f ? dt(f) : "start"} – ${t ? dt(t) : "today"}` };
  }
  const now = new Date(Date.now() + 5.5 * 3600000); // IST wall clock in UTC fields
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1, d = now.getUTCDate();
  const fyStart = m >= 4 ? y : y - 1;
  const q0 = Math.floor((m - 1) / 3) * 3 + 1;
  const win: Record<string, [string, string]> = {
    today: [ymd(y, m, d), ymd(y, m, d + 1)],
    this_month: [ymd(y, m, 1), ymd(y, m + 1, 1)],
    last_month: [ymd(y, m - 1, 1), ymd(y, m, 1)],
    this_quarter: [ymd(y, q0, 1), ymd(y, q0 + 3, 1)],
    this_fy: [ymd(fyStart, 4, 1), ymd(fyStart + 1, 4, 1)],
    last_fy: [ymd(fyStart - 1, 4, 1), ymd(fyStart, 4, 1)],
  };
  const p = str(args.period);
  const w = win[p];
  return w ? { from: ist(w[0]), to: ist(w[1]), label: p } : { from: null, to: null, label: "all" };
}
const inRange = (r: { from: Date | null; to: Date | null }, v: unknown) => {
  if (!v) return false;
  const t = new Date(String(/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? `${v}T00:00:00+05:30` : v)).getTime();
  return (!r.from || t >= r.from.getTime()) && (!r.to || t < r.to.getTime());
};
function byCreated<T extends { gte: any; lt: any }>(q: T, r: { from: Date | null; to: Date | null }): T {
  let x = q;
  if (r.from) x = x.gte("created_at", r.from.toISOString());
  if (r.to) x = x.lt("created_at", r.to.toISOString());
  return x;
}
const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message); };

// ── loans ────────────────────────────────────────────────────────────────
const LOAN_COLS = "id, loan_display_id, aadhaar_name, borrower_name, borrower_mobile, status, plant_use_type, system_type, " +
  "loan_amount_required, loan_amount, sanctioned_amount, approved_lender, approved_at, created_at, " +
  "first_disbursement_amount, first_disbursement_date, second_disbursement_amount, second_disbursement_date, aborted_at, " +
  "epc_business:epc_business_id(trade_name, legal_name, contact_name)";
const LOAN_STAGES = ["draft", "submitted", "under_review", "docs_sent", "on_hold", "approved", "rejected", "1st_tranche_disbursed", "fully_disbursed", "aborted"];

function loanStage(r: Row): string {
  if (r.aborted_at) return "aborted";
  if (r.second_disbursement_amount != null) return "fully_disbursed";
  if (r.first_disbursement_amount != null) return "1st_tranche_disbursed";
  return r.status || "draft";
}
const loanRow = (r: Row) => ({
  loan_id: r.loan_display_id,
  applicant: r.aadhaar_name || r.borrower_name || null,
  mobile: r.borrower_mobile,
  epc: epcName(r.epc_business),
  stage: loanStage(r),
  type: r.plant_use_type,
  applied_amount: num(r.loan_amount_required ?? r.loan_amount),
  sanctioned_amount: num(r.sanctioned_amount),
  lender: lender(r.approved_lender),
  first_disbursement: r.first_disbursement_amount != null ? { amount: num(r.first_disbursement_amount), date: dt(r.first_disbursement_date) } : null,
  second_disbursement: r.second_disbursement_amount != null ? { amount: num(r.second_disbursement_amount), date: dt(r.second_disbursement_date) } : null,
  created_on: dt(r.created_at),
  approved_on: r.approved_at ? dt(r.approved_at) : null,
});

async function findLoan(db: SupabaseClient, id: string, cols: string): Promise<Row> {
  const key = id.trim();
  const q = db.from("epc_applications").select(cols);
  const { data, error } = await (/^[0-9a-f-]{36}$/i.test(key) ? q.eq("id", key) : q.ilike("loan_display_id", clean(key))).maybeSingle();
  fail(error);
  if (!data) throw new Error(`No loan application "${key}".`);
  return data as Row;
}

// ── EPCs ─────────────────────────────────────────────────────────────────
const EPC_COLS = "id, epc_display_id, trade_name, legal_name, contact_name, contact_mobile, contact_email, status, service_type, created_at";
async function lenderMap(db: SupabaseClient, ids: string[]): Promise<Map<string, Row[]>> {
  const m = new Map<string, Row[]>();
  if (!ids.length) return m;
  const { data, error } = await db.from("epc_lender_status").select("business_id, lender, docs_given, approved, rejected").in("business_id", ids);
  fail(error);
  for (const r of (data ?? []) as Row[]) m.set(r.business_id, [...(m.get(r.business_id) ?? []), r]);
  return m;
}
function epcStage(r: Row, ls: Row[]): string {
  if (ls.some((x) => x.approved)) return "approved_by_lender";
  if (ls.some((x) => x.rejected)) return "rejected_by_lender";
  if (ls.some((x) => x.docs_given)) return "docs_sent_to_lender";
  return ({ approved: "approved_by_cc", rejected: "rejected_by_cc", on_hold: "on_hold", draft: "draft" } as Record<string, string>)[r.status] ?? "under_review";
}
const epcRow = (r: Row, ls: Row[]) => ({
  epc_id: r.epc_display_id,
  name: epcName(r),
  contact: r.contact_name,
  mobile: r.contact_mobile,
  email: r.contact_email,
  stage: epcStage(r, ls),
  service: r.service_type,
  lenders_approved: ls.filter((x) => x.approved).map((x) => lender(x.lender)),
  joined_on: dt(r.created_at),
});

// ── tools ────────────────────────────────────────────────────────────────
export const MCP_TOOLS: McpTool[] = [
  {
    name: "loan_summary",
    description: "Loan-application numbers for a period: files created, files by stage, approved files + sanctioned amount, approvals by lender, 1st / 2nd tranche disbursed (by disbursement date) and 2nd tranche still pending.",
    inputSchema: { type: "object", properties: { ...periodProp } },
    async run(db, args) {
      const r = range(args);
      const { data, error } = await db.from("epc_applications").select(
        "status, loan_amount_required, loan_amount, sanctioned_amount, approved_lender, created_at, aborted_at, " +
        "first_disbursement_amount, first_disbursement_date, second_disbursement_amount, second_disbursement_date, " + FIRST_CHARGE_COLS);
      fail(error);
      const all = (data ?? []) as Row[];
      const created = all.filter((x) => !r.from && !r.to ? true : inRange(r, x.created_at));
      const byStage: Record<string, number> = {};
      for (const x of created) byStage[loanStage(x)] = (byStage[loanStage(x)] ?? 0) + 1;
      const approved = created.filter((x) => !x.aborted_at && (x.first_disbursement_amount != null || ["approved", "rfd", "sent_to_nbfc", "disbursed"].includes(x.status)));
      const byLender: Record<string, number> = {};
      for (const x of approved) { const l = lender(x.approved_lender) ?? "—"; byLender[l] = (byLender[l] ?? 0) + 1; }
      const sum = (list: Row[], f: (x: Row) => number) => list.reduce((s, x) => s + f(x), 0);
      const t1 = all.filter((x) => x.first_disbursement_amount != null && (!r.from && !r.to ? true : inRange(r, x.first_disbursement_date)));
      const t2 = all.filter((x) => x.second_disbursement_amount != null && (!r.from && !r.to ? true : inRange(r, x.second_disbursement_date)));
      const pending2 = created.filter((x) => !x.aborted_at && x.first_disbursement_amount != null && x.second_disbursement_amount == null);
      return {
        period: r.label,
        files_created: created.length,
        by_stage: byStage,
        approved: { files: approved.length, sanctioned_amount: sum(approved, (x) => Number(x.sanctioned_amount) || Number(x.loan_amount_required ?? x.loan_amount) || 0) },
        approved_by_lender: byLender,
        first_tranche_disbursed: { files: t1.length, amount: sum(t1, (x) => Number(x.first_disbursement_amount) || 0) },
        second_tranche_disbursed: { files: t2.length, amount: sum(t2, (x) => Number(x.second_disbursement_amount) || 0) },
        second_tranche_pending: { files: pending2.length, amount: sum(pending2, (x) => remainingAmount(x.sanctioned_amount, x.first_disbursement_amount, firstCharges(x)) ?? 0) },
      };
    },
  },
  {
    name: "search_loans",
    description: "List loan applications, newest first. Filter by applicant name / loan ID / mobile, stage, lender and created-date period.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "Applicant name, loan ID (e.g. CC-RES-00210) or mobile." },
      stage: { type: "string", enum: LOAN_STAGES },
      lender: { type: "string", description: "Lender key, e.g. creditfair, aerem, solfin (or any lender added in the portal)." },
      ...periodProp,
      limit: { type: "number", description: "Max rows (default 50, max 200)." },
    } },
    async run(db, args) {
      let q = db.from("epc_applications").select(LOAN_COLS).order("created_at", { ascending: false }).limit(limitOf(args.limit));
      const s = clean(args.query);
      if (s) q = q.or(`aadhaar_name.ilike.*${s}*,borrower_name.ilike.*${s}*,loan_display_id.ilike.*${s}*,borrower_mobile.ilike.*${s}*`);
      const st = str(args.stage);
      if (st === "aborted") q = q.not("aborted_at", "is", null);
      else if (st) {
        q = q.is("aborted_at", null);
        if (st === "fully_disbursed") q = q.not("second_disbursement_amount", "is", null);
        else if (st === "1st_tranche_disbursed") q = q.not("first_disbursement_amount", "is", null).is("second_disbursement_amount", null);
        else q = q.eq("status", st).is("first_disbursement_amount", null);
      }
      if (str(args.lender)) q = q.eq("approved_lender", str(args.lender));
      q = byCreated(q, range(args));
      const { data, error } = await q;
      fail(error);
      const rows = ((data ?? []) as Row[]).map(loanRow);
      return { count: rows.length, rows };
    },
  },
  {
    name: "get_loan",
    description: "Full detail of one loan application by loan ID (e.g. CC-RES-00210): applicant, co-applicant, plant, amounts, approval details, disbursements, review status, history.",
    inputSchema: { type: "object", properties: { loan_id: { type: "string" } }, required: ["loan_id"] },
    async run(db, args) {
      const r = await findLoan(db, str(args.loan_id), LOAN_COLS + ", borrower_email, borrower_city, borrower_state, install_city, install_district, install_state, install_pincode, " +
        "project_size, project_size_unit, total_project_cost, selected_tenure_years, selected_monthly_emi, coapp_name, coapp_aadhaar_name, coapp_relation, " +
        "lead_owner_name, approval_details, rejection_reason, abort_reason, status_history, approval_review_status, disb1_review_status, disb2_review_status, credit_score, " +
        FIRST_CHARGE_COLS);
      return {
        ...loanRow(r),
        email: r.borrower_email,
        city: r.install_city || r.borrower_city, district: r.install_district, state: r.install_state || r.borrower_state, pincode: r.install_pincode,
        system: { type: r.system_type, size: r.project_size ? `${r.project_size} ${r.project_size_unit ?? ""}`.trim() : null, project_cost: num(r.total_project_cost) },
        selected_tenure_years: r.selected_tenure_years, selected_emi: num(r.selected_monthly_emi),
        co_applicant: r.coapp_aadhaar_name || r.coapp_name ? { name: r.coapp_aadhaar_name || r.coapp_name, relation: r.coapp_relation } : null,
        lead_owner: r.lead_owner_name,
        approval: r.approval_details ? {
          approved_amount: num(r.approval_details.approved_loan_amount), tenure_years: r.approval_details.approved_tenure_years,
          emi: num(r.approval_details.approved_emi), roi_percent: r.approval_details.approved_roi ?? r.approval_details.roi ?? null,
          approval_date: r.approval_details.approval_date ? dt(r.approval_details.approval_date) : null, credit_score: r.credit_score,
        } : null,
        review: { approval: r.approval_review_status, disbursement_1: r.disb1_review_status, disbursement_2: r.disb2_review_status },
        first_disbursement_charges: r.first_disbursement_amount != null ? {
          processing_fee_incl_gst: num(r.first_processing_fee), legal_charges: num(r.first_legal_charges), cersai_charges: num(r.first_cersai_charges),
        } : null,
        second_tranche_pending: r.first_disbursement_amount != null && r.second_disbursement_amount == null ? remainingAmount(r.sanctioned_amount, r.first_disbursement_amount, firstCharges(r)) : null,
        rejection_reason: r.rejection_reason, abort_reason: r.abort_reason,
        history: Array.isArray(r.status_history) ? r.status_history.map((h: Row) => ({ from: h.from, to: h.to, on: dt(h.at), note: h.note ?? null })) : [],
      };
    },
  },
  {
    name: "list_pendings",
    description: "Files waiting for the main admin's check (Pendings): approval details and 1st / 2nd disbursements entered by the team.",
    inputSchema: { type: "object", properties: {} },
    async run(db) {
      const { data, error } = await db.from("epc_applications")
        .select(LOAN_COLS + ", approval_review_status, disb1_review_status, disb2_review_status").or(PENDING_FILTER).order("updated_at", { ascending: false });
      fail(error);
      const rows = ((data ?? []) as Row[]).map((r) => ({
        ...loanRow(r),
        waiting: [r.approval_review_status === "pending" && "approval details", r.disb1_review_status === "pending" && "1st disbursement", r.disb2_review_status === "pending" && "2nd disbursement"].filter(Boolean),
      }));
      return { count: rows.length, rows };
    },
  },
  {
    name: "search_epcs",
    description: "List EPC partners, newest first. Filter by name / EPC ID / mobile and created-date period. Each row has the EPC's stage (CC review / lender status) and lenders that approved it.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "EPC name, contact name, EPC ID or mobile." },
      ...periodProp,
      limit: { type: "number", description: "Max rows (default 50, max 200)." },
    } },
    async run(db, args) {
      let q = db.from("epc_business").select(EPC_COLS).or("business_type.is.null,business_type.neq.admin")
        .order("created_at", { ascending: false }).limit(limitOf(args.limit));
      const s = clean(args.query);
      if (s) q = q.or(`trade_name.ilike.*${s}*,legal_name.ilike.*${s}*,contact_name.ilike.*${s}*,epc_display_id.ilike.*${s}*,contact_mobile.ilike.*${s}*`);
      q = byCreated(q, range(args));
      const { data, error } = await q;
      fail(error);
      const list = (data ?? []) as Row[];
      const ls = await lenderMap(db, list.map((r) => r.id));
      const rows = list.map((r) => epcRow(r, ls.get(r.id) ?? []));
      return { count: rows.length, rows };
    },
  },
  {
    name: "get_epc",
    description: "One EPC partner by EPC ID or name: contact, stage, lender statuses, and its loan applications counted by stage.",
    inputSchema: { type: "object", properties: { epc: { type: "string", description: "EPC ID or name." } }, required: ["epc"] },
    async run(db, args) {
      const s = clean(args.epc);
      if (!s) throw new Error("Give an EPC ID or name.");
      const { data, error } = await db.from("epc_business").select(EPC_COLS + ", business_type")
        .or(`epc_display_id.ilike.${s},trade_name.ilike.*${s}*,legal_name.ilike.*${s}*`).limit(5);
      fail(error);
      const found = ((data ?? []) as Row[]).filter((r) => r.business_type !== "admin");
      if (!found.length) throw new Error(`No EPC matching "${s}".`);
      if (found.length > 1 && !found.some((r) => String(r.epc_display_id).toLowerCase() === s.toLowerCase())) {
        return { matches: found.map((r) => ({ epc_id: r.epc_display_id, name: epcName(r) })), note: "Several EPCs match — ask again with the EPC ID." };
      }
      const r = found.find((x) => String(x.epc_display_id).toLowerCase() === s.toLowerCase()) ?? found[0];
      const ls = (await lenderMap(db, [r.id])).get(r.id) ?? [];
      const { data: loans, error: lErr } = await db.from("epc_applications")
        .select("status, aborted_at, first_disbursement_amount, second_disbursement_amount").eq("epc_business_id", r.id);
      fail(lErr);
      const byStage: Record<string, number> = {};
      for (const x of (loans ?? []) as Row[]) byStage[loanStage(x)] = (byStage[loanStage(x)] ?? 0) + 1;
      return {
        ...epcRow(r, ls),
        lender_status: ls.map((x) => ({ lender: lender(x.lender), docs_sent: !!x.docs_given, approved: !!x.approved, rejected: !!x.rejected })),
        loan_applications: { total: (loans ?? []).length, by_stage: byStage },
      };
    },
  },
  {
    name: "search_insurance",
    description: "List insurance files, newest first. kind 'solar' (EPC solar insurance, default) or 'other' (general insurance). Filter by insured name / ID and created-date period; shows policy validity.",
    inputSchema: { type: "object", properties: {
      kind: { type: "string", enum: ["solar", "other"] },
      query: { type: "string", description: "Insured / customer name or insurance ID." },
      ...periodProp,
      limit: { type: "number", description: "Max rows (default 50, max 200)." },
    } },
    async run(db, args) {
      const s = clean(args.query);
      const other = str(args.kind) === "other";
      let q = other
        ? db.from("other_insurance").select("display_id, customer_name, sum_insured, insurance_company, policy_path, policy_from_date, policy_to_date, created_at")
        : db.from("insurance_applications").select("insurance_display_id, aadhaar_name, status, sum_insured, insurance_partner, policy_from_date, policy_to_date, created_at, epc_business:epc_business_id(trade_name, legal_name, contact_name)");
      if (s) q = q.or(other ? `customer_name.ilike.*${s}*,display_id.ilike.*${s}*` : `aadhaar_name.ilike.*${s}*,insurance_display_id.ilike.*${s}*`);
      q = byCreated(q.order("created_at", { ascending: false }).limit(limitOf(args.limit)), range(args));
      const { data, error } = await q;
      fail(error);
      const rows = ((data ?? []) as Row[]).map((r) => ({
        id: other ? r.display_id : r.insurance_display_id,
        insured: other ? r.customer_name : r.aadhaar_name,
        ...(other ? {} : { epc: epcName(r.epc_business), status: r.status }),
        ...(other ? { status: r.policy_path ? "issued" : "awaiting_policy" } : {}),
        sum_insured: num(r.sum_insured),
        insurer: other ? r.insurance_company : r.insurance_partner,
        policy_valid: r.policy_from_date || r.policy_to_date ? `${dt(r.policy_from_date)} – ${dt(r.policy_to_date)}` : null,
        created_on: dt(r.created_at),
      }));
      return { count: rows.length, rows };
    },
  },
  {
    name: "search_leads",
    description: "List loan leads (before they become applications), newest first. Filter by name / lead ID / mobile and created-date period.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "Lead name, lead ID or mobile." },
      ...periodProp,
      limit: { type: "number", description: "Max rows (default 50, max 200)." },
    } },
    async run(db, args) {
      let q = db.from("loan_leads").select("lead_display_id, name, mobile, loan_amount, status, lead_owner_name, converted_application_id, dead_at, aborted_at, created_at, epc_name_custom, epc_business:epc_business_id(trade_name, legal_name, contact_name)")
        .order("created_at", { ascending: false }).limit(limitOf(args.limit));
      const s = clean(args.query);
      if (s) q = q.or(`name.ilike.*${s}*,lead_display_id.ilike.*${s}*,mobile.ilike.*${s}*`);
      q = byCreated(q, range(args));
      const { data, error } = await q;
      fail(error);
      const rows = ((data ?? []) as Row[]).map((r) => ({
        lead_id: r.lead_display_id, name: r.name, mobile: r.mobile, epc: epcName(r.epc_business) || r.epc_name_custom,
        loan_amount: num(r.loan_amount), lead_owner: r.lead_owner_name,
        state: r.converted_application_id ? "converted" : r.aborted_at ? "aborted" : r.dead_at ? "dead" : r.status,
        created_on: dt(r.created_at),
      }));
      return { count: rows.length, rows };
    },
  },
];
