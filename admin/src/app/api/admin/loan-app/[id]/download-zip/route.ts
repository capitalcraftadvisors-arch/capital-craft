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

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import archiver from "archiver";
import { summaryRows } from "@/lib/lender-summary";
import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { downloadBuffer } from "@/lib/gcs";
import { getBearerToken, verifyJwt } from "@/lib/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Same 3 lenders (and same labels) as the EPC ZIP route.
const LENDER_KEYS = ["creditfair", "aerem", "solfin"] as const;
type LenderKey = typeof LENDER_KEYS[number];
const LENDER_LABEL: Record<LenderKey, string> = {
  creditfair: "Credit Fair",
  aerem:      "Aerem",
  solfin:     "Solfin",
};

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function baseName(path: string): string {
  return path.split("/").pop() || "file";
}

function rupees(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) && v !== 0 ? "₹" + Math.round(v).toLocaleString("en-IN") : "—";
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);

    const appId = params.id;
    if (!UUID_RE.test(appId)) return err("Invalid application id.", 400);

    // Lender is required — the picker popup always supplies it.
    const lenderParam = (new URL(req.url).searchParams.get("lender") ?? "").toLowerCase();
    if (!LENDER_KEYS.includes(lenderParam as LenderKey)) {
      return err("missing_or_invalid_lender", 400);
    }
    const lender = lenderParam as LenderKey;

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [{ data: loan, error: loadErr }, { data: docs }] = await Promise.all([
      supabase.from("epc_applications")
        .select("*, epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)")
        .eq("id", appId)
        .maybeSingle(),
      supabase.from("user_application_docs")
        .select("id, category, storage_path, file_name")
        .eq("application_id", appId),
    ]);
    if (loadErr) return err(loadErr.message, 500);
    if (!loan)   return err("Loan application not found.", 404);

    const displayId: string =
      loan.loan_display_id || "LA-" + appId.replace(/-/g, "").slice(0, 8).toUpperCase();
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
    const rows = summaryRows(loan, { displayId, epcName, epcDisplayId: loan.epc_business?.epc_display_id }, lender);
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
    const safeName = `${displayId}_${borrowerName}_${LENDER_LABEL[lender]}`
      .replace(/[^\w-]+/g, "_")
      .slice(0, 80);
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
    console.error("[loan-zip] error:", msg);
    return err(msg, 500);
  }
}
