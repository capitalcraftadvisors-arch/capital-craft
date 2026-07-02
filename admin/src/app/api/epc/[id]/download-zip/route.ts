// GET /api/epc/[id]/download-zip
//
// Admin-only. Streams a fresh ZIP for the given EPC containing:
//   - summary.xlsx            (Excel workbook: all profile data as
//                              label + value rows on a single sheet.
//                              Documents are intentionally OMITTED
//                              from the workbook — the files themselves
//                              are in the ZIP folders.)
//   - documents/<category>/…  (pan_business, gstin, extra_doc, cancelled_cheque, office_*)
//   - documents/members/<Member N - name>/{pan,aadhaar_front,aadhaar_back,aadhaar_legacy}/…
//   - gst_r3b/…               (admin-only R3B files, prefixed by period-year)
//
// Response is streamed (archiver → Node Readable → Web ReadableStream) so
// the ZIP is never fully buffered. Missing GCS files are logged and
// skipped — the workbook doesn't record them, but the ZIP still succeeds.
//
// No caching — every request regenerates a fresh ZIP with current data.

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

type Doc = {
  id: string;
  business_id: string;
  stakeholder_id: string | null;
  category: string;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  metadata: Record<string, unknown> | null;
  stored_size_bytes: number | null;
  created_at: string;
};

type Stakeholder = {
  id: string;
  name?: string;
  designation?: string;
  mobile?: string;
  email?: string;
};

type Reference = {
  type: "customer" | "supplier";
  name: string;
  mobile: string;
};

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
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

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ── Profile ────────────────────────────────────────────────────────
    const { data: biz, error: bizErr } = await supabase
      .from("epc_business")
      .select("*")
      .eq("id", params.id)
      .maybeSingle();
    if (bizErr) return err(bizErr.message, 500);
    if (!biz) return err("epc_not_found", 404);

    // ── Documents ──────────────────────────────────────────────────────
    const { data: docsData } = await supabase
      .from("epc_documents")
      .select(
        "id, business_id, stakeholder_id, category, storage_path, file_name, mime_type, metadata, stored_size_bytes, created_at",
      )
      .eq("business_id", params.id)
      .order("category", { ascending: true })
      .order("created_at", { ascending: true });
    const docs = (docsData ?? []) as Doc[];

    // ── Admin info (may not exist yet) ────────────────────────────────
    let adminInfo: Record<string, unknown> | null = null;
    try {
      const r = await supabase
        .from("epc_admin_info")
        .select("*")
        .eq("business_id", params.id)
        .maybeSingle();
      adminInfo = (r.data as Record<string, unknown>) ?? null;
    } catch {
      adminInfo = null;
    }

    // ── Filename ──────────────────────────────────────────────────────
    const nameForFile = sanitizeName(
      (biz.trade_name as string) ||
      (biz.legal_name as string) ||
      (biz.contact_name as string) ||
      String(biz.id).slice(0, 8),
    );
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `EPC_${nameForFile}_${dateStr}.zip`;

    // ── Archive ───────────────────────────────────────────────────────
    const archive = archiver("zip", { zlib: { level: 3 } });
    archive.on("warning", (e) => console.warn("[download-zip] archive warning:", e));
    archive.on("error",   (e) => console.error("[download-zip] archive error:", e));

    void (async () => {
      try {
        const stakeholders = ((biz.stakeholders ?? []) as unknown[]).map(
          (s) => s as Stakeholder,
        );
        const memberLabelById = new Map<string, string>();
        stakeholders.forEach((s, i) => {
          const nameBit = s.name && s.name.trim() ? ` - ${s.name.trim()}` : "";
          memberLabelById.set(s.id, `Member ${i + 1}${nameBit}`);
        });

        // Download + append each document. Missing files are silently
        // skipped (logged); the workbook doesn't mention them.
        for (const doc of docs) {
          const zipPath = pathInZip(doc, memberLabelById);
          try {
            const buf = await downloadBuffer(doc.storage_path);
            archive.append(buf, {
              name: zipPath,
              date: doc.created_at ? new Date(doc.created_at) : undefined,
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(
              `[download-zip] missing/failed: ${doc.storage_path} — ${msg}`,
            );
          }
        }

        // Excel summary — one sheet, label + value rows.
        // OMITS: documents list, lender status. Bank account is FULL/unmasked
        // (the value the EPC typed and reconfirmed at Step 4).
        const xlsx = await buildSummaryXlsx({
          biz: biz as Record<string, unknown>,
          adminInfo,
        });
        archive.append(xlsx, { name: "summary.xlsx" });

        await archive.finalize();
      } catch (e) {
        console.error("[download-zip] build error:", e);
        archive.abort();
      }
    })();

    const webStream = Readable.toWeb(archive) as unknown as ReadableStream;
    return new Response(webStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[download-zip] error:", msg);
    return err(msg, 500);
  }
}

// ── Filename / path helpers ───────────────────────────────────────────

function sanitizeName(s: string): string {
  const trimmed = (s || "").replace(/[^\w\-]+/g, "_").slice(0, 60);
  return trimmed || "epc";
}

function sanitizeSegment(s: string): string {
  const cleaned = (s || "").replace(/[<>:"|?*\\/\x00-\x1F]+/g, "_").trim();
  return cleaned || "file";
}

function extFromMime(mime: string | null | undefined): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("pdf"))  return ".pdf";
  if (m.includes("jpeg") || m.includes("jpg")) return ".jpg";
  if (m.includes("png"))  return ".png";
  if (m.includes("webp")) return ".webp";
  return "";
}

function fallbackFileName(doc: Doc): string {
  return `${doc.id.slice(0, 8)}${extFromMime(doc.mime_type)}` || "file";
}

function pathInZip(doc: Doc, memberLabelById: Map<string, string>): string {
  const fname = sanitizeSegment(doc.file_name || fallbackFileName(doc));

  if (doc.category === "gst_r3b") {
    const m = (doc.metadata ?? {}) as Record<string, unknown>;
    const pt = m.period_type as string | undefined;
    const label = pt === "monthly"
      ? (m.month as string | undefined)
      : (m.quarter as string | undefined);
    const year = m.year as number | undefined;
    const prefix = label && year ? `${label}-${year}_` : "";
    return `gst_r3b/${sanitizeSegment(prefix + fname)}`;
  }

  if (
    doc.category === "stakeholder_pan" ||
    doc.category === "stakeholder_aadhaar" ||
    doc.category === "stakeholder_aadhaar_front" ||
    doc.category === "stakeholder_aadhaar_back"
  ) {
    const label = doc.stakeholder_id
      ? (memberLabelById.get(doc.stakeholder_id) ??
         `Member (${doc.stakeholder_id.slice(0, 8)})`)
      : "Member (unknown)";
    const kind =
      doc.category === "stakeholder_pan"            ? "pan" :
      doc.category === "stakeholder_aadhaar_front"  ? "aadhaar_front" :
      doc.category === "stakeholder_aadhaar_back"   ? "aadhaar_back" :
      /* stakeholder_aadhaar (legacy) */              "aadhaar_legacy";
    return `documents/members/${sanitizeSegment(label)}/${kind}/${fname}`;
  }

  return `documents/${sanitizeSegment(doc.category)}/${fname}`;
}

// ── Excel summary ─────────────────────────────────────────────────────

const BUSINESS_TYPE_LABEL: Record<string, string> = {
  proprietorship: "Proprietorship",
  pvt_ltd:        "Private Limited",
  partnership:    "Partnership",
  llp:            "LLP",
};

function fmtDate(v: unknown): string {
  if (!v) return "";
  try {
    return new Date(String(v)).toLocaleString("en-IN", {
      dateStyle: "medium", timeStyle: "short",
    });
  } catch {
    return String(v);
  }
}

function display(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return s.trim();
}

async function buildSummaryXlsx(data: {
  biz: Record<string, unknown>;
  adminInfo: Record<string, unknown> | null;
}): Promise<Buffer> {
  const { biz, adminInfo } = data;

  const stakeholders = ((biz.stakeholders ?? []) as unknown[]).map((s) => s as Stakeholder);
  const refs = ((biz.business_references ?? []) as unknown[]).map((r) => r as Reference);
  const customers = refs.filter((r) => r.type === "customer");
  const suppliers = refs.filter((r) => r.type === "supplier");

  const btLabel = BUSINESS_TYPE_LABEL[(biz.business_type as string) ?? ""] ?? String(biz.business_type ?? "");
  const suryaGhar = biz.pm_surya_ghar as string | null;
  const suryaGharDisplay = suryaGhar === "other"
    ? `Other — ${display(biz.pm_surya_ghar_other)}`
    : suryaGhar
      ? suryaGhar.charAt(0).toUpperCase() + suryaGhar.slice(1)
      : "";

  const wb = new ExcelJS.Workbook();
  wb.creator = "Capital Craft — admin export";
  wb.created = new Date();

  const ws = wb.addWorksheet("Profile");
  ws.columns = [
    { header: "", key: "label", width: 34 },
    { header: "", key: "value", width: 60 },
  ];

  // Header row.
  const titleText = String(biz.trade_name || biz.legal_name || biz.contact_name || "EPC");
  const titleRow = ws.addRow([titleText, ""]);
  titleRow.getCell(1).font = { bold: true, size: 16, color: { argb: "FF0F3D2E" } };
  ws.mergeCells(titleRow.number, 1, titleRow.number, 2);
  const generated = ws.addRow([`Generated ${new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`, ""]);
  generated.getCell(1).font = { italic: true, color: { argb: "FF5A8A76" }, size: 10 };
  ws.mergeCells(generated.number, 1, generated.number, 2);
  ws.addRow([]);

  // Utility to add a section heading and a set of key-value rows.
  const section = (name: string, rows: Array<[string, unknown]>) => {
    const headingRow = ws.addRow([name.toUpperCase(), ""]);
    headingRow.getCell(1).font = { bold: true, size: 11, color: { argb: "FF178A5C" } };
    headingRow.getCell(1).alignment = { vertical: "middle" };
    ws.mergeCells(headingRow.number, 1, headingRow.number, 2);
    for (const [label, value] of rows) {
      const r = ws.addRow([label, display(value) || "—"]);
      r.getCell(1).font = { bold: true, color: { argb: "FF5A8A76" } };
      r.getCell(2).alignment = { wrapText: true, vertical: "top" };
    }
    ws.addRow([]);
  };

  // ── META ─────────────────────────────────────────────────────────
  section("Meta", [
    ["EPC Display ID", biz.epc_display_id],
    ["Internal status", biz.status],
    ["Loan-app unlocked", biz.loan_app_unlocked === true ? "Yes" : "No"],
    ["Grandfathered", biz.loan_app_grandfathered === true ? "Yes" : "No"],
    ["Source", biz.source],
    ["Current step", biz.current_step],
    ["EPC self-edited", biz.epc_self_edited === true ? "Yes" : "No"],
    ["Created", fmtDate(biz.created_at)],
    ["Submitted", fmtDate(biz.submitted_at)],
    ["Last updated", fmtDate(biz.updated_at)],
    ["Row ID (uuid)", biz.id],
  ]);

  // ── PERSONAL ─────────────────────────────────────────────────────
  section("Personal", [
    ["Point of contact", biz.contact_name],
    ["Email", biz.contact_email],
    ["Mobile (login)", biz.contact_mobile ? `+91 ${display(biz.contact_mobile)}` : ""],
    ["Designation", biz.contact_designation],
  ]);

  // ── BUSINESS ─────────────────────────────────────────────────────
  section("Business", [
    ["Legal name", biz.legal_name],
    ["Trade name", biz.trade_name],
    ["Business type", btLabel],
    ["PAN", biz.pan_number],
    ["GSTIN", biz.gstin_number],
    ["PM Surya Ghar", suryaGharDisplay],
  ]);

  // ── BANK — account number is FULL/unmasked ───────────────────────
  // The value stored in epc_business.bank_account_number is what the
  // EPC re-entered in the "re-confirm account number" field on Step 4
  // (Step 4 blocks Save & continue until reconfirm matches). The admin
  // detail edit path also persists the raw digits. Masking is UI-only.
  section("Bank", [
    ["Account holder", biz.bank_account_holder],
    ["Account number", biz.bank_account_number],
    ["IFSC", biz.bank_ifsc],
    ["Bank name", biz.bank_name],
  ]);

  // ── MEMBERS ──────────────────────────────────────────────────────
  const memberRows: Array<[string, unknown]> = [];
  if (stakeholders.length === 0) {
    memberRows.push(["(none)", ""]);
  } else {
    stakeholders.forEach((s, i) => {
      const prefix = `${i + 1}.`;
      memberRows.push([`${prefix} Name`, s.name]);
      memberRows.push([`${prefix} Designation`, s.designation]);
      memberRows.push([`${prefix} Mobile`, s.mobile ? `+91 ${s.mobile}` : ""]);
      memberRows.push([`${prefix} Email`, s.email]);
    });
  }
  section(`Members (${stakeholders.length})`, memberRows);

  // ── REFERENCES ───────────────────────────────────────────────────
  const refRows: Array<[string, unknown]> = [];
  if (refs.length === 0) {
    refRows.push(["(none)", ""]);
  } else {
    customers.forEach((r, i) => {
      refRows.push([`Customer ${i + 1} name`, r.name]);
      refRows.push([`Customer ${i + 1} mobile`, r.mobile ? `+91 ${r.mobile}` : ""]);
    });
    suppliers.forEach((r, i) => {
      refRows.push([`Supplier ${i + 1} name`, r.name]);
      refRows.push([`Supplier ${i + 1} mobile`, r.mobile ? `+91 ${r.mobile}` : ""]);
    });
  }
  section(`References (${refs.length})`, refRows);

  // ── ADMIN INFO ───────────────────────────────────────────────────
  if (adminInfo) {
    section("Admin business info", [
      ["Team size", adminInfo.team_size],
      ["Installed capacity (Residential)", `${display(adminInfo.capacity_residential)} ${display(adminInfo.capacity_residential_unit)}`.trim()],
      ["Installed capacity (Commercial)",  `${display(adminInfo.capacity_commercial)} ${display(adminInfo.capacity_commercial_unit)}`.trim()],
      ["Turnover (last FY)", adminInfo.turnover_last_fy],
    ]);
  }

  // Lender status is intentionally OMITTED from the Excel per spec.

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
