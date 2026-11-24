// GET /api/admin/loan-app/[id]/download-zip?lender=creditfair|aerem|solfin
//
// Admin-only. Streams a fresh ZIP for the given loan application. The lender
// is REQUIRED (same contract as /api/epc/[id]/download-zip): it stamps
// "Submitted to" in the Excel summary and goes into the ZIP filename, so
// downloads for the same application across lenders don't collide.
//
// Contents:
//   - summary.xlsx                     applicant / loan / bank / offer sheet
//   - aadhaar/{front,back,face}        applicant KYC images
//   - coapp/{aadhaar_front,back,pan}   co-applicant docs (when present)
//   - bills/{proforma,ebill}           Step 3 uploads
//   - bank_statement/                  Step 4 upload
//   - rooftop/                         geo-tagged install photo
//   - docs/<category>/                 anything in user_application_docs
//                                      (borrower PAN from Step 1, etc.)
//
// Doc sources are TWO-fold by design: the extract-* routes upload
// straight to GCS and store paths on the epc_applications row, while
// Step 1's PAN goes through /api/upload into user_application_docs.
// The ZIP walks both.
//
// Streaming pattern mirrors /api/epc/[id]/download-zip (archiver →
// Node Readable → Web ReadableStream). Missing GCS objects are logged
// and skipped so one lost file never fails the whole ZIP.

import { NextRequest } from "next/server";
import archiver from "archiver";
import { summaryRows } from "@/lib/lender-summary";
import { fetchLenders, lenderLabelIn } from "@/lib/loan-lenders";
import ExcelJS from "exceljs";
import { downloadBuffer } from "@/lib/gcs";
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { loanDisplayId } from "@/lib/loan-labels";
import { baseName, loadLoanAndDocs, zipResponse } from "@/lib/zip-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Same 3 lenders (and same labels) as the EPC ZIP route.

// (removed a dead local rupees() helper — this route uses summaryRows from lib/lender-summary)

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

    // Lender is required — the picker popup always supplies it.
    const lender = (new URL(req.url).searchParams.get("lender") ?? "").toLowerCase();

    const supabase = dbAs(token);
    // Any lender the portal works with (the registry) — not a fixed list.
    const lenders = await fetchLenders(supabase);
    if (!lenders.some((l) => l.key === lender)) return err("missing_or_invalid_lender", 400);
    const lenderLabel = lenderLabelIn(lenders, lender);

    const { loan, error: loadErr, docs } = await loadLoanAndDocs(supabase, appId);
    if (loadErr) return err(loadErr.message, 500);
    if (!loan)   return err("Loan application not found.", 404);

    const displayId = loanDisplayId(appId, loan.loan_display_id);
    const borrowerName: string = loan.borrower_name || loan.aadhaar_name || "applicant";
    const epcName: string =
      loan.epc_business?.trade_name || loan.epc_business?.legal_name ||
      loan.epc_business?.contact_name || "—";

    // ── summary.xlsx ────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Application");
    ws.columns = [{ width: 30 }, { width: 46 }];
    const title = ws.addRow(["Capital Craft — Loan Application", ""]);
    title.font = { bold: true, size: 14 };
    ws.addRow([]);
    // Rows come from the shared builder: Credit Fair gets its dedicated field
    // layout; Solfin / Aerem keep the general layout.
    const rows = summaryRows(loan, { displayId, epcName, epcDisplayId: loan.epc_business?.epc_display_id }, lenderLabel);
    for (const [k, v] of rows) {
      const r = ws.addRow([k, v]);
      r.getCell(1).font = { bold: true, color: { argb: "FF0F3D2E" } };
    }
    const xlsxBuffer = Buffer.from(await wb.xlsx.writeBuffer());

    // ── Assemble the archive ────────────────────────────────
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("warning", (e) => console.warn("[loan-zip] warning:", e));
    archive.on("error",   (e) => { throw e; });

    archive.append(xlsxBuffer, { name: "summary.xlsx" });

    // Doc paths stored directly on the row (extract-* uploads).
    // NOTE: approval documents — none are stored (approval_details is numeric
    // only). Disbursement/completion docs live in user_application_docs and are
    // swept up by the docs loop below, so they're already in the ZIP.
    const rowDocs: Array<{ path: string | null; folder: string }> = [
      { path: loan.aadhaar_front_path,       folder: "aadhaar" },
      { path: loan.aadhaar_back_path,        folder: "aadhaar" },
      { path: loan.aadhaar_face_path,        folder: "aadhaar" },
      { path: loan.customer_photo_path,      folder: "applicant_photo" },
      { path: loan.coapp_aadhaar_front_path, folder: "coapp" },
      { path: loan.coapp_aadhaar_back_path,  folder: "coapp" },
      { path: loan.coapp_aadhaar_face_path,  folder: "coapp" },
      { path: loan.coapp_pan_path,           folder: "coapp" },
      { path: loan.proforma_invoice_path,    folder: "bills" },
      { path: loan.ebill_path,               folder: "bills" },
      { path: loan.bank_statement_path,      folder: "bank_statement" },
      { path: loan.rooftop_photo_path,       folder: "rooftop" },
    ];
    for (const d of rowDocs) {
      if (!d.path) continue;
      try {
        const buf = await downloadBuffer(d.path);
        archive.append(buf, { name: `${d.folder}/${baseName(d.path)}` });
      } catch (e) {
        console.warn(`[loan-zip] skipping missing object ${d.path}:`, e);
      }
    }

    // Docs in user_application_docs (Step 1 PAN, rooftop photo row, etc.)
    for (const d of (docs ?? []) as Array<{ category: string; storage_path: string; file_name: string | null }>) {
      try {
        const buf = await downloadBuffer(d.storage_path);
        archive.append(buf, { name: `docs/${d.category}/${d.file_name || baseName(d.storage_path)}` });
      } catch (e) {
        console.warn(`[loan-zip] skipping missing object ${d.storage_path}:`, e);
      }
    }

    void archive.finalize();

    // Filename includes the lender so downloads for the same application
    // across multiple lenders don't collide (same as the EPC ZIP).
    const safeName = `${displayId}_${borrowerName}_${lenderLabel}`
      .replace(/[^\w-]+/g, "_")
      .slice(0, 80);
    return zipResponse(archive, safeName);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[loan-zip] error:", msg);
    return err(msg, 500);
  }
}
