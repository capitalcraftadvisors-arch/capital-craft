// GET /api/admin/loan-reports?type=monthly&month=YYYY-MM | ?type=pending
//
// The Loans tab's downloadable Excel reports (admin only, the caller's JWT so
// RLS applies). One read of the disbursed loans per download.
//   monthly — lender-wise disbursements of a month: every loan with its 1st or
//             2nd disbursement dated in that month, grouped by lender, with the
//             month's disbursed total per lender (a disbursement from another
//             month is shown greyed and not counted).
//   pending — 2nd tranche pending: 1st disbursed, 2nd not yet; the 2nd's due
//             date (45 days after the 1st), the amount still to come (approved −
//             1st) and how many days it has been pending (since the 1st).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { fetchLenders, lenderLabelIn, type Lender } from "@/lib/loan-lenders";
import { deadlineState, remainingAmount, firstCharges, FIRST_CHARGE_COLS } from "@/lib/disbursement";
import { fmtDate } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_MS = 86_400_000;
// ₹ with Indian grouping (lakh / crore).
const RUPEE_FMT = '[>=10000000]"₹"##\\,##\\,##\\,##0;[>=100000]"₹"##\\,##\\,##0;"₹"##,##0';
const GREEN = "FF178A5C", GREEN_TINT = "FFE6F6EE", GREY = "FF9AA5A0", RED = "FFDC2626";

type Loan = {
  loan_display_id: string | null; borrower_name: string | null; aadhaar_name: string | null;
  total_project_cost: number | null; loan_amount_required: number | null; loan_amount: number | null;
  sanctioned_amount: number | null; approved_lender: string | null; aborted_at: string | null;
  approval_details: { applied_loan_amount?: number | null; approved_loan_amount?: number | null; roi?: number | string | null; approved_tenure_years?: number | null; applied_tenure_years?: number | null } | null;
  first_disbursement_amount: number | null; first_disbursement_date: string | null;
  second_disbursement_amount: number | null; second_disbursement_date: string | null;
  first_processing_fee: number | null; first_legal_charges: number | null; first_cersai_charges: number | null;
  epc_business: { trade_name: string | null; legal_name: string | null; contact_name: string | null } | null;
};

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const epcOf = (l: Loan) => l.epc_business?.trade_name || l.epc_business?.legal_name || l.epc_business?.contact_name || "—";
const borrowerOf = (l: Loan) => l.aadhaar_name || l.borrower_name || "—";
const approvedOf = (l: Loan) => num(l.sanctioned_amount) ?? num(l.approval_details?.approved_loan_amount);
const day = (d: string | null) => (d ? fmtDate(d) : "");

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);

    const sp = req.nextUrl.searchParams;
    const type = sp.get("type");
    const month = sp.get("month") ?? "";
    if (type !== "monthly" && type !== "pending") return err("Unknown report.", 400);
    if (type === "monthly" && !MONTH_RE.test(month)) return err("Pick a month.", 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const [{ data, error }, lenders] = await Promise.all([
      supabase.from("epc_applications")
        .select(
          "loan_display_id, borrower_name, aadhaar_name, total_project_cost, loan_amount_required, loan_amount, " +
          "sanctioned_amount, approved_lender, aborted_at, approval_details, " +
          "first_disbursement_amount, first_disbursement_date, second_disbursement_amount, second_disbursement_date, " +
          FIRST_CHARGE_COLS + ", epc_business:epc_business_id(trade_name, legal_name, contact_name)",
        )
        .not("first_disbursement_date", "is", null),
      fetchLenders(supabase),
    ]);
    if (error) return err(error.message, 500);
    const loans = ((data ?? []) as unknown as Loan[]).filter((l) => !l.aborted_at);

    const wb = new ExcelJS.Workbook();
    const buf = type === "monthly" ? await monthly(wb, loans, lenders, month) : await pending(wb, loans, lenders);
    const name = type === "monthly" ? `Lender-wise disbursements ${month}.xlsx` : `2nd tranche pending ${fmtDate(new Date()).replace(/\//g, "-")}.xlsx`;
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[loan-reports] error:", msg);
    return err(msg, 500);
  }
}

// ── Sheet helpers ────────────────────────────────────────────────────────────
// A title line, then a two-row header: single columns span both rows, a pair
// ("1st disbursement" → Date | Amount) spans two columns.
type Col = { label: string; width: number; pair?: [string, string] };
function header(ws: ExcelJS.Worksheet, title: string, cols: Col[]): number {
  const total = cols.reduce((n, c) => n + (c.pair ? 2 : 1), 0);
  ws.addRow([title]).font = { bold: true, size: 14, color: { argb: GREEN } };
  ws.mergeCells(1, 1, 1, total);
  ws.addRow([]);
  const r1 = ws.getRow(3), r2 = ws.getRow(4);
  let c = 1;
  for (const col of cols) {
    if (col.pair) {
      r1.getCell(c).value = col.label;
      ws.mergeCells(3, c, 3, c + 1);
      r2.getCell(c).value = col.pair[0];
      r2.getCell(c + 1).value = col.pair[1];
      ws.getColumn(c).width = 13;
      ws.getColumn(c + 1).width = col.width;
      c += 2;
    } else {
      r1.getCell(c).value = col.label;
      ws.mergeCells(3, c, 4, c);
      ws.getColumn(c).width = col.width;
      c += 1;
    }
  }
  for (const r of [r1, r2]) {
    for (let i = 1; i <= total; i++) {
      const cell = r.getCell(i);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = { top: { style: "thin", color: { argb: "FFCDEADD" } }, bottom: { style: "thin", color: { argb: "FFCDEADD" } }, left: { style: "thin", color: { argb: "FFCDEADD" } }, right: { style: "thin", color: { argb: "FFCDEADD" } } };
    }
  }
  ws.views = [{ state: "frozen", ySplit: 4 }];
  return total;
}
function money(row: ExcelJS.Row, cols: number[]) {
  for (const c of cols) row.getCell(c).numFmt = RUPEE_FMT;
}
function totalRow(ws: ExcelJS.Worksheet, values: unknown[], moneyCols: number[]) {
  const row = ws.addRow(values);
  row.font = { bold: true };
  row.eachCell({ includeEmpty: true }, (cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN_TINT } }; });
  money(row, moneyCols);
}

// ── Monthly lender-wise disbursements ────────────────────────────────────────
async function monthly(wb: ExcelJS.Workbook, loans: Loan[], lenders: Lender[], month: string) {
  const inMonth = (d: string | null) => !!d && d.slice(0, 7) === month;
  const rows = loans.filter((l) => inMonth(l.first_disbursement_date) || inMonth(l.second_disbursement_date));
  const monthName = new Date(`${month}-01T00:00:00`).toLocaleString("en-IN", { month: "long", year: "numeric" });
  const ws = wb.addWorksheet("Disbursements");
  header(ws, `Lender-wise disbursements — ${monthName}`, [
    { label: "EPC name", width: 28 }, { label: "Borrower name", width: 24 }, { label: "Lender name", width: 16 },
    { label: "Project cost", width: 14 }, { label: "Applied loan", width: 14 }, { label: "Approved loan", width: 14 },
    { label: "ROI", width: 9 }, { label: "Tenure", width: 10 },
    { label: "1st disbursement", width: 14, pair: ["Date", "Amount"] },
    { label: "2nd disbursement", width: 14, pair: ["Date", "Amount"] },
  ]);
  const MONEY = [4, 5, 6, 10, 12];
  // Lender by lender (registry order), loans by their first date.
  const byLender = new Map<string, Loan[]>();
  for (const l of rows) {
    const k = l.approved_lender ?? "";
    byLender.set(k, [...(byLender.get(k) ?? []), l]);
  }
  const order = [...byLender.keys()].sort((a, b) => {
    const ia = lenders.findIndex((x) => x.key === a), ib = lenders.findIndex((x) => x.key === b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
  });
  let grand1 = 0, grand2 = 0;
  for (const key of order) {
    const name = key ? lenderLabelIn(lenders, key) : "No lender";
    let sum1 = 0, sum2 = 0;
    const group = (byLender.get(key) ?? []).sort((a, b) => String(a.first_disbursement_date).localeCompare(String(b.first_disbursement_date)));
    for (const l of group) {
      const d = l.approval_details ?? {};
      const roi = num(d.roi);
      const tenure = num(d.approved_tenure_years) ?? num(d.applied_tenure_years);
      const a1 = num(l.first_disbursement_amount), a2 = num(l.second_disbursement_amount);
      const in1 = inMonth(l.first_disbursement_date), in2 = inMonth(l.second_disbursement_date);
      if (in1 && a1) sum1 += a1;
      if (in2 && a2) sum2 += a2;
      const row = ws.addRow([
        epcOf(l), borrowerOf(l), name,
        num(l.total_project_cost), num(d.applied_loan_amount) ?? num(l.loan_amount_required) ?? num(l.loan_amount), approvedOf(l),
        roi != null ? `${roi}%` : "", tenure != null ? `${tenure} ${tenure === 1 ? "year" : "years"}` : "",
        day(l.first_disbursement_date), a1, day(l.second_disbursement_date), a2,
      ]);
      money(row, MONEY);
      // A disbursement from another month is shown for reference, not counted.
      if (!in1) for (const c of [9, 10]) row.getCell(c).font = { color: { argb: GREY }, italic: true };
      if (!in2) for (const c of [11, 12]) row.getCell(c).font = { color: { argb: GREY }, italic: true };
    }
    totalRow(ws, [`${name} — disbursed in ${monthName}`, ...Array(8).fill(""), "", sum1, "", sum2], [10, 12]);
    ws.mergeCells(ws.rowCount, 1, ws.rowCount, 9);
    grand1 += sum1; grand2 += sum2;
  }
  if (rows.length === 0) ws.addRow(["No disbursements in this month."]);
  else {
    totalRow(ws, [`Total disbursed in ${monthName}`, ...Array(8).fill(""), "", grand1, "", grand2], [10, 12]);
    ws.mergeCells(ws.rowCount, 1, ws.rowCount, 9);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── 2nd tranche pending ──────────────────────────────────────────────────────
async function pending(wb: ExcelJS.Workbook, loans: Loan[], lenders: Lender[]) {
  const today = new Date();
  const start = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`);
  const rows = loans
    .filter((l) => l.first_disbursement_date && l.second_disbursement_amount == null)
    .map((l) => ({ l, days: Math.max(0, Math.floor((today.getTime() - start(l.first_disbursement_date!).getTime()) / DAY_MS)) }))
    .sort((a, b) => b.days - a.days);
  const ws = wb.addWorksheet("2nd tranche pending");
  header(ws, `2nd tranche pending — as on ${fmtDate(today)}`, [
    { label: "EPC name", width: 28 }, { label: "Borrower name", width: 24 }, { label: "Lender name", width: 16 },
    { label: "Project cost", width: 14 }, { label: "Approved loan", width: 14 },
    { label: "2nd disbursement", width: 14, pair: ["Due date", "Amount"] },
    { label: "Pending days", width: 12 },
  ]);
  let sum = 0;
  for (const { l, days } of rows) {
    const due = deadlineState(l.first_disbursement_date, false).deadline;
    const left = remainingAmount(approvedOf(l), l.first_disbursement_amount, firstCharges(l));
    if (left) sum += left;
    const row = ws.addRow([
      epcOf(l), borrowerOf(l), l.approved_lender ? lenderLabelIn(lenders, l.approved_lender) : "—",
      num(l.total_project_cost), approvedOf(l), due ? fmtDate(due) : "", left, days,
    ]);
    money(row, [4, 5, 7]);
    // Past the 45-day window → red.
    if (due && today.getTime() > due.getTime()) row.getCell(8).font = { bold: true, color: { argb: RED } };
  }
  if (rows.length === 0) ws.addRow(["No 2nd tranche pending."]);
  else {
    totalRow(ws, ["Total pending", "", "", "", "", "", sum, ""], [7]);
    ws.mergeCells(ws.rowCount, 1, ws.rowCount, 6);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
