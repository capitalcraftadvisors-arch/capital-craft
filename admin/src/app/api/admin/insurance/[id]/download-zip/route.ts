// GET /api/admin/insurance/[id]/download-zip
//
// Admin-only. Streams a ZIP for the insurance application: a summary.xlsx plus
// every stored document (PAN, Aadhaar front/back/face, GST, plant photo,
// invoice). Mirrors the loan ZIP route (archiver → Node Readable → Web
// ReadableStream); missing GCS objects are logged and skipped.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import archiver from "archiver";
import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { downloadBuffer } from "@/lib/gcs";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { SUPABASE_URL, SUPABASE_ANON, UUID_RE } from "@/lib/insurance-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}
function baseName(path: string): string { return path.split("/").pop() || "file"; }
function rupees(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) && v !== 0 ? "₹" + Math.round(v).toLocaleString("en-IN") : "—";
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);

    const id = params.id;
    if (!UUID_RE.test(id)) return err("Invalid application id.", 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: app, error: loadErr } = await supabase
      .from("insurance_applications")
      .select("*, epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)")
      .eq("id", id)
      .maybeSingle();
    if (loadErr) return err(loadErr.message, 500);
    if (!app) return err("Insurance application not found.", 404);

    const displayId: string = app.insurance_display_id || "INS-" + id.replace(/-/g, "").slice(0, 8).toUpperCase();
    const applicant: string = app.aadhaar_name || "applicant";
    const epcName: string = app.epc_business?.trade_name || app.epc_business?.legal_name || app.epc_business?.contact_name || "—";

    // ── summary.xlsx ────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Insurance");
    ws.columns = [{ width: 30 }, { width: 46 }];
    const title = ws.addRow(["Capital Craft — Insurance Application", ""]);
    title.font = { bold: true, size: 14 };
    ws.addRow([]);
    const rows: Array<[string, string]> = [
      ["Insurance ID", displayId],
      ["Insurance partner", app.insurance_partner ?? "—"],
      ["Sum insured", rupees(app.sum_insured ?? app.invoice_confirmed_amount)],
      ["Status", String(app.status ?? "—")],
      ["Submitted", app.submitted_at ? new Date(app.submitted_at).toLocaleString("en-IN") : "—"],
      ["EPC Partner", `${epcName}${app.epc_business?.epc_display_id ? ` (${app.epc_business.epc_display_id})` : ""}`],
      ["", ""],
      ["Applicant", applicant],
      ["PAN", app.pan_number ?? "—"],
      ["GST legal name", app.gst_legal_name ?? "—"],
      ["GST trade name", app.gst_trade_name ?? "—"],
      ["GSTIN", app.gstin ?? "—"],
      ["Policy period", app.policy_from_date && app.policy_to_date ? `${app.policy_from_date} to ${app.policy_to_date}` : "—"],
      ["Aadhaar", app.aadhaar_number_masked ?? "—"],
      ["DOB", app.aadhaar_dob ?? "—"],
      ["Gender", app.aadhaar_gender ?? "—"],
      ["Address (Aadhaar)", app.aadhaar_address ?? "—"],
      ["", ""],
      ["Plant address", app.plant_address ?? "—"],
      ["Invoice amount (confirmed)", rupees(app.invoice_confirmed_amount)],
      ["Invoice amount (OCR)", rupees(app.invoice_amount)],
    ];
    for (const [label, col] of [
      ["Panel photo GPS", "photo_panel_gps"],
      ["Inverter photo GPS", "photo_inverter_gps"],
      ["Meter photo GPS", "photo_meter_gps"],
    ] as const) {
      const g = app[col] as { lat?: number; lng?: number } | null;
      if (g && g.lat != null) rows.push([label, `${g.lat}, ${g.lng}`]);
    }
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
    const webStream = Readable.toWeb(archive) as unknown as ReadableStream;
    return new NextResponse(webStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeName}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[insurance-zip] error:", msg);
    return err(msg, 500);
  }
}
