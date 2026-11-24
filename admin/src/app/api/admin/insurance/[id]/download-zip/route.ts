// GET /api/admin/insurance/[id]/download-zip
//
// Admin-only. Streams a ZIP for the insurance application: a summary.xlsx (the
// 12 fields the insurer needs — ID, project cost = sum insured, applicant as per
// the bill, PAN, Aadhaar, DOB, gender, Aadhaar address, risk location, mobile,
// email) plus
// every stored document (PAN, Aadhaar front/back/face, GST, plant photo,
// invoice). Mirrors the loan ZIP route (archiver → Node Readable → Web
// ReadableStream); missing GCS objects are logged and skipped.

import { NextRequest } from "next/server";
import archiver from "archiver";
import ExcelJS from "exceljs";
import { downloadBuffer } from "@/lib/gcs";
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { rupees } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { baseName, zipResponse } from "@/lib/zip-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// rupees imported from @/lib/money

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireLogin(req, { role: "admin" });
    if (auth instanceof Response) return auth;
    const { token } = auth;

    const id = params.id;
    if (!UUID_RE.test(id)) return err("Invalid application id.", 400);

    const supabase = dbAs(token);
    const { data: app, error: loadErr } = await supabase
      .from("insurance_applications")
      .select("*, epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)")
      .eq("id", id)
      .maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!app) return err("Insurance application not found.", 404);

    const displayId: string = app.insurance_display_id || "INS-" + id.replace(/-/g, "").slice(0, 8).toUpperCase();
    const applicant: string = app.aadhaar_name || "applicant";

    // The loan this insurance was made from (0112), if any — the customer's
    // mobile / email and the bill name live there.
    const { data: loan } = await supabase.from("epc_applications")
      .select("borrower_mobile, borrower_email, ebill_name, ebill_address_line, total_project_cost")
      .eq("insurance_application_id", id).maybeSingle();
    // What the electricity-bill reader returned (stored as JSON when it read cleanly).
    let bill: { ebill_name?: string | null; ebill_address_line?: string | null } = {};
    try { bill = JSON.parse(String(app.ebill_ocr_raw ?? "")); } catch { /* plain OCR text */ }
    const dash = (v: unknown) => (v == null || String(v).trim() === "" ? "—" : String(v));
    const projectCost = app.invoice_confirmed_amount ?? app.sum_insured ?? loan?.total_project_cost ?? app.invoice_amount;

    // ── summary.xlsx ────────────────────────────────────────
    // Only these fields (the team's list, 18/11): the sum insured equals the project cost.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Insurance");
    ws.columns = [{ width: 34 }, { width: 60 }];
    const title = ws.addRow(["Capital Craft — Insurance Application", ""]);
    title.font = { bold: true, size: 14 };
    ws.addRow([]);
    const rows: Array<[string, string]> = [
      ["Insurance ID", displayId],
      ["Project Cost", rupees(projectCost)],
      ["Sum Insured", rupees(projectCost)],
      ["Applicant Name (as per electricity bill)", dash(bill.ebill_name || loan?.ebill_name || app.aadhaar_name)],
      ["PAN", dash(app.pan_number)],
      ["Aadhaar", dash(app.aadhaar_number_masked)],
      ["DOB", app.aadhaar_dob ? fmtDate(app.aadhaar_dob) : "—"],
      ["Gender", dash(app.aadhaar_gender)],
      ["Address as per Aadhaar", dash(app.aadhaar_address)],
      ["Risk Location Address (as per electricity bill)", dash(app.plant_address || bill.ebill_address_line || loan?.ebill_address_line)],
      ["Mobile No", dash(loan?.borrower_mobile)],
      ["Email ID", dash(loan?.borrower_email)],
    ];
    for (const [k, v] of rows) {
      const r = ws.addRow([k, v]);
      r.getCell(1).font = { bold: true, color: { argb: "FF0F3D2E" } };
    }
    const xlsxBuffer = Buffer.from(await wb.xlsx.writeBuffer());

    // ── Assemble ────────────────────────────────────────────
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("warning", (e) => console.warn("[insurance-zip] warning:", e));
    archive.on("error", (e) => { throw e; });
    archive.append(xlsxBuffer, { name: "summary.xlsx" });

    const docs: Array<{ path: string | null; folder: string }> = [
      { path: app.pan_path,             folder: "pan" },
      { path: app.aadhaar_front_path,   folder: "aadhaar" },
      { path: app.aadhaar_back_path,    folder: "aadhaar" },
      { path: app.aadhaar_face_path,    folder: "aadhaar" },
      { path: app.gst_path,             folder: "gst" },
      { path: app.ebill_path,           folder: "ebill" },
      { path: app.policy_path,          folder: "policy" },
      { path: app.photo_panel_path,     folder: "photos" },
      { path: app.photo_inverter_path,  folder: "photos" },
      { path: app.photo_meter_path,     folder: "photos" },
      { path: app.invoice_path,         folder: "invoice" },
      { path: app.plant_photo_path,     folder: "photos" },  // legacy
    ];
    for (const d of docs) {
      if (!d.path) continue;
      try {
        const buf = await downloadBuffer(d.path);
        archive.append(buf, { name: `${d.folder}/${baseName(d.path)}` });
      } catch (e) {
        console.warn(`[insurance-zip] skipping missing object ${d.path}:`, e);
      }
    }
    void archive.finalize();

    const safeName = `${displayId}_${applicant}`.replace(/[^\w-]+/g, "_").slice(0, 80);
    return zipResponse(archive, safeName);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[insurance-zip] error:", msg);
    return err(msg, 500);
  }
}
