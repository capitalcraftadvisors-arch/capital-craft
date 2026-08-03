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

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import archiver from "archiver";
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

    const trancheParam = (new URL(req.url).searchParams.get("tranche") ?? "").trim();
    if (trancheParam !== "1" && trancheParam !== "2") return err("missing_or_invalid_tranche", 400);
    const tranche = trancheParam as "1" | "2";
    const expected = TRANCHE_DOCS[tranche];
    const wantCats = new Set(expected.map((e) => e.category));

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [{ data: loan, error: loadErr }, { data: docsAll }] = await Promise.all([
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

    const docs = (docsAll ?? []).filter((d: { category: string }) => wantCats.has(d.category));
    const haveCats = new Set(docs.map((d: { category: string }) => d.category));

    const displayId: string =
      loan.loan_display_id || "LA-" + appId.replace(/-/g, "").slice(0, 8).toUpperCase();
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
    const webStream = Readable.toWeb(archive) as unknown as ReadableStream;
    return new NextResponse(webStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeName}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[tranche-zip] error:", msg);
    return err(msg, 500);
  }
}
