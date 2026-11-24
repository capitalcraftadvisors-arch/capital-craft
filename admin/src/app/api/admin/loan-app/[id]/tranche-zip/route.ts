// GET /api/admin/loan-app/[id]/tranche-zip?tranche=1|2
//
// Admin-only. Streams a ZIP containing ONLY that tranche's documents plus a
// small per-tranche summary sheet (applicant / co-applicant / approved amount /
// K number + a ✓/✗ checklist of the tranche's EXPECTED docs). No lender pack,
// no *_path columns, no full summary, no schema changes. Auth + streaming
// mirror /api/admin/loan-app/[id]/download-zip.
//
//   Tranche 1: feasibility_report, mmr_advance_receipt
//   Tranche 2: completion_invoice + 3 geo photos + completion_report

import { NextRequest } from "next/server";
import archiver from "archiver";
import ExcelJS from "exceljs";
import { downloadBuffer } from "@/lib/gcs";
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { loanDisplayId } from "@/lib/loan-labels";
import { baseName, loadLoanAndDocs, zipResponse } from "@/lib/zip-response";
import { rupees } from "@/lib/money";
import { errText } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Expected docs per tranche (category → checklist label).
const TRANCHE_DOCS: Record<"1" | "2", { category: string; label: string }[]> = {
  "1": [
    { category: "feasibility_report",  label: "Feasibility Approval Report" },
    { category: "mmr_advance_receipt", label: "MMR / Advance Receipt" },
  ],
  "2": [
    { category: "completion_invoice",        label: "Invoice / Tax invoice" },
    { category: "completion_panel_photo",    label: "Customer with panel (geo-tagged)" },
    { category: "completion_inverter_photo", label: "Customer with inverter (geo-tagged)" },
    { category: "completion_meter_photo",    label: "Customer with meter (geo-tagged)" },
    { category: "completion_report",         label: "Work Completion Report" },
  ],
};

// rupees imported from @/lib/money

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireLogin(req, { role: "admin" });
    if (auth instanceof Response) return auth;
    const { token } = auth;

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    const trancheParam = (new URL(req.url).searchParams.get("tranche") ?? "").trim();
    if (trancheParam !== "1" && trancheParam !== "2") return err("missing_or_invalid_tranche", 400);
    const tranche = trancheParam as "1" | "2";
    const expected = TRANCHE_DOCS[tranche];
    const wantCats = new Set(expected.map((e) => e.category));

    const supabase = dbAs(token);

    const { loan, error: loadErr, docs: docsAll } = await loadLoanAndDocs(supabase, appId);
    if (loadErr) return err(loadErr.message, 500);
    if (!loan)   return err("Loan application not found.", 404);

    const docs = (docsAll ?? []).filter((d: { category: string }) => wantCats.has(d.category));
    const haveCats = new Set(docs.map((d: { category: string }) => d.category));

    const displayId = loanDisplayId(appId, loan.loan_display_id);
    const borrowerName: string = loan.borrower_name || loan.aadhaar_name || "applicant";

    // Approved amount — sanctioned_amount first, approval_details.approved_loan_amount fallback.
    const approvedAmount =
      loan.sanctioned_amount != null
        ? loan.sanctioned_amount
        : (loan.approval_details && typeof loan.approval_details === "object"
            ? (loan.approval_details as Record<string, unknown>).approved_loan_amount
            : null);

    // ── Small per-tranche summary sheet ─────────────────────────
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`Tranche ${tranche}`);
    ws.columns = [{ width: 34 }, { width: 40 }];
    const title = ws.addRow([`Tranche ${tranche} — Document Pack`]);
    title.font = { bold: true, size: 14 };
    ws.addRow([]);
    ws.addRow(["Applicant", borrowerName]);
    ws.addRow(["Co-applicant", loan.coapp_name || "—"]);
    ws.addRow(["Approved amount", rupees(approvedAmount)]);
    ws.addRow(["K number", loan.ca_number || "—"]);
    ws.addRow([]);
    const chkHdr = ws.addRow(["Document checklist", ""]);
    chkHdr.font = { bold: true };
    for (const e of expected) {
      ws.addRow([e.label, haveCats.has(e.category) ? "✓ Attached" : "✗ Missing"]);
    }
    for (let i = 3; i <= 6; i++) ws.getRow(i).getCell(1).font = { color: { argb: "FF5A8A76" } };
    const xlsxBuffer = Buffer.from(await wb.xlsx.writeBuffer());

    // ── Archive ─────────────────────────────────────────────────
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("warning", (e) => console.warn("[tranche-zip] warning:", e));
    archive.on("error", (e) => { throw e; });
    archive.append(xlsxBuffer, { name: `Tranche ${tranche} — Summary.xlsx` });

    for (const d of docs) {
      try {
        const buf = await downloadBuffer(d.storage_path);
        archive.append(buf, { name: `${d.category}/${d.file_name || baseName(d.storage_path)}` });
      } catch (e) {
        console.warn("[tranche-zip] missing object:", d.storage_path, (e as Error)?.message);
      }
    }
    void archive.finalize();

    const safeName = `${displayId}_${borrowerName}_Tranche${tranche}`
      .replace(/[^\w-]+/g, "_")
      .slice(0, 80);
    return zipResponse(archive, safeName);
  } catch (e: unknown) {
    const msg = errText(e);
    console.error("[tranche-zip] error:", msg);
    return err(msg, 500);
  }
}
