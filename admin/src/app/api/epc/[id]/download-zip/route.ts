// GET /api/epc/[id]/download-zip?lender=creditfair|aerem|solfin
//
// Admin-only. Streams a fresh ZIP for the given EPC containing:
//   - summary.xlsx            AEREM-template workbook. Title reads
//                              "For CreditFair" / "For Aerem" / "For Solfin"
//                              per the chosen lender; sections are identical
//                              across all three lenders. See buildAeremXlsx.
//                              Documents are OMITTED from the workbook —
//                              the files themselves live in the ZIP folders.
//   - documents/<category>/…  pan_business, gstin, extra_doc, cancelled_cheque, office_*
//   - documents/members/<Member N - name>/{pan,aadhaar_front,aadhaar_back,aadhaar_legacy}/…
//   - gst_r3b/…               admin-only R3B files, prefixed by period-year
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

const LENDER_KEYS = ["creditfair", "aerem", "solfin"] as const;
type LenderKey = typeof LENDER_KEYS[number];

const LENDER_LABEL: Record<LenderKey, string> = {
  creditfair: "CreditFair",
  aerem:      "Aerem",
  solfin:     "Solfin",
};

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

    // ── Lender query param — required ──────────────────────────────────
    const lenderParam = (new URL(req.url).searchParams.get("lender") ?? "").toLowerCase();
    if (!LENDER_KEYS.includes(lenderParam as LenderKey)) {
      return err("missing_or_invalid_lender", 400);
    }
    const lender = lenderParam as LenderKey;

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

    // ── Filename — includes lender so downloads for the same EPC across
    // multiple lenders don't collide.
    const nameForFile = sanitizeName(
      (biz.trade_name as string) ||
      (biz.legal_name as string) ||
      (biz.contact_name as string) ||
      String(biz.id).slice(0, 8),
    );
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `EPC_${nameForFile}_${LENDER_LABEL[lender]}_${dateStr}.zip`;

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

        // Track every doc as we walk it — feeds the manifest.txt at the
        // end of the build.
        type Entry =
          | { status: "INCLUDED"; category: string; storage_path: string; zip_path: string; size: number; file_name: string | null }
          | { status: "MISSING";  category: string; storage_path: string; zip_path: string; error: string; file_name: string | null };
        const manifest: Entry[] = [];

        // Download + append each document. Missing files are logged and
        // recorded in the manifest but never abort the build.
        for (const doc of docs) {
          const zipPath = pathInZip(doc, memberLabelById);
          try {
            const buf = await downloadBuffer(doc.storage_path);
            archive.append(buf, {
              name: zipPath,
              date: doc.created_at ? new Date(doc.created_at) : undefined,
            });
            manifest.push({
              status: "INCLUDED",
              category: doc.category,
              file_name: doc.file_name,
              storage_path: doc.storage_path,
              zip_path: zipPath,
              size: buf.length,
            });
            console.log(`[download-zip] included ${doc.category} ${doc.storage_path} (${buf.length}B) -> ${zipPath}`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(
              `[download-zip] missing/failed: ${doc.storage_path} — ${msg}`,
            );
            manifest.push({
              status: "MISSING",
              category: doc.category,
              file_name: doc.file_name,
              storage_path: doc.storage_path,
              zip_path: zipPath,
              error: msg,
            });
          }
        }

        // Excel summary.
        const xlsx = await buildAeremXlsx({
          biz: biz as Record<string, unknown>,
          adminInfo,
          docs,
          stakeholders,
          lender,
        });
        archive.append(xlsx, { name: "summary.xlsx" });

        // manifest.txt — cheap diagnostic that documents exactly what
        // ended up in the ZIP vs what the DB knew about. Open this file
        // any time a ZIP looks incomplete.
        archive.append(buildManifest(biz as Record<string, unknown>, lender, manifest), {
          name: "manifest.txt",
        });

        await archive.finalize();
        console.log(`[download-zip] finalized: ${manifest.filter((m) => m.status === "INCLUDED").length}/${manifest.length} docs included, lender=${lender}`);
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

// ── AEREM Excel template ──────────────────────────────────────────────

const BUSINESS_TYPE_LABEL: Record<string, string> = {
  proprietorship: "Proprietorship",
  pvt_ltd:        "Private Limited",
  partnership:    "Partnership",
  llp:            "LLP",
};

function display(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return s.trim();
}

const COLOR_BRAND_GREEN     = "FF178A5C";
const COLOR_BRAND_GREEN_BG  = "FFDCEFE4";
const COLOR_SECTION_BG      = "FFE5E7EB";
const COLOR_SECTION_TEXT    = "FF0F3D2E";
const COLOR_LABEL           = "FF374151";
const COLOR_MUTED           = "FF6B7280";

async function buildAeremXlsx(data: {
  biz: Record<string, unknown>;
  adminInfo: Record<string, unknown> | null;
  docs: Doc[];
  stakeholders: Stakeholder[];
  lender: LenderKey;
}): Promise<Buffer> {
  const { biz, adminInfo, docs, stakeholders, lender } = data;

  // GST turnover — sum of total_taxable_value across all uploaded R3B docs.
  // Matches the total the View page already displays for the admin.
  const r3bTotal = docs
    .filter((d) => d.category === "gst_r3b")
    .reduce((s, d) => {
      const v = (d.metadata as { total_taxable_value?: number } | null)?.total_taxable_value;
      return typeof v === "number" && !isNaN(v) ? s + v : s;
    }, 0);

  // Per-stakeholder doc presence flags.
  const hasPan = new Map<string, boolean>();
  const hasAadhaarFront = new Map<string, boolean>();
  const hasAadhaarBack = new Map<string, boolean>();
  const hasAadhaarLegacy = new Map<string, boolean>();
  for (const d of docs) {
    if (!d.stakeholder_id) continue;
    const id = d.stakeholder_id;
    if (d.category === "stakeholder_pan")            hasPan.set(id, true);
    if (d.category === "stakeholder_aadhaar_front")  hasAadhaarFront.set(id, true);
    if (d.category === "stakeholder_aadhaar_back")   hasAadhaarBack.set(id, true);
    if (d.category === "stakeholder_aadhaar")        hasAadhaarLegacy.set(id, true);
  }

  const refs = ((biz.business_references ?? []) as unknown[]).map((r) => r as Reference);
  const customers = refs.filter((r) => r.type === "customer");
  const suppliers = refs.filter((r) => r.type === "supplier");
  const buyer1 = customers[0] ?? { name: "", mobile: "" };
  const buyer2 = customers[1] ?? { name: "", mobile: "" };
  const supplier1 = suppliers[0] ?? { name: "", mobile: "" };
  const supplier2 = suppliers[1] ?? { name: "", mobile: "" };

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

  const ws = wb.addWorksheet("Summary");

  // Column widths tuned for the stakeholder table: label column wide (28),
  // then one wide column per stakeholder (24 each). Minimum 2 columns so
  // small EPCs with 1 stakeholder still get some breathing room.
  const stakeholderCols = Math.max(2, stakeholders.length);
  const totalCols = 1 + stakeholderCols;
  ws.getColumn(1).width = 34;
  for (let c = 2; c <= totalCols; c++) {
    ws.getColumn(c).width = 26;
  }

  // ── Title: "For <LENDER>" ───────────────────────────────────────
  const titleRow = ws.addRow([`For ${LENDER_LABEL[lender]}`]);
  ws.mergeCells(titleRow.number, 1, titleRow.number, totalCols);
  const titleCell = titleRow.getCell(1);
  titleCell.font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_BRAND_GREEN } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleRow.height = 32;
  ws.addRow([]);

  // ── Utility: section heading (grey band across all columns) ────
  const sectionHeader = (label: string) => {
    const r = ws.addRow([label]);
    ws.mergeCells(r.number, 1, r.number, totalCols);
    const c = r.getCell(1);
    c.font = { bold: true, size: 12, color: { argb: COLOR_SECTION_TEXT } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_SECTION_BG } };
    c.alignment = { vertical: "middle" };
    r.height = 22;
  };

  // Value row for the standard 2-column sections (label | value).
  const kv = (label: string, value: unknown) => {
    const r = ws.addRow([label, display(value) || "—", ...Array(totalCols - 2).fill("")]);
    r.getCell(1).font = { bold: true, color: { argb: COLOR_LABEL } };
    r.getCell(2).alignment = { wrapText: true, vertical: "top" };
    if (totalCols > 2) ws.mergeCells(r.number, 2, r.number, totalCols);
  };

  // ── Business Details ────────────────────────────────────────────
  sectionHeader("Business Details");
  kv("Legal name",   biz.legal_name);
  kv("Trade name",   biz.trade_name);
  kv("Business type", btLabel);
  kv("PAN",          biz.pan_number);
  kv("GSTIN",        biz.gstin_number);
  kv("PM Surya Ghar", suryaGharDisplay);
  ws.addRow([]);

  // ── Stakeholder Details (columns per stakeholder) ──────────────
  sectionHeader("Stakeholder Details");
  // Header row: "" | Stake Holder 1 | Stake Holder 2 | ...
  const shHeader = ws.addRow([
    "",
    ...Array.from({ length: stakeholderCols }, (_, i) => `Stake Holder ${i + 1}`),
  ]);
  shHeader.eachCell({ includeEmpty: false }, (c, idx) => {
    if (idx === 1) return;
    c.font = { bold: true, color: { argb: COLOR_SECTION_TEXT } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_BRAND_GREEN_BG } };
    c.alignment = { horizontal: "center" };
  });

  // Field labels down column A; one column per stakeholder for the value.
  const stakeholderField = (label: string, valueFor: (s: Stakeholder | undefined) => string) => {
    const values = Array.from({ length: stakeholderCols }, (_, i) => valueFor(stakeholders[i]));
    const r = ws.addRow([label, ...values]);
    r.getCell(1).font = { bold: true, color: { argb: COLOR_LABEL } };
    for (let c = 2; c <= totalCols; c++) {
      const cell = r.getCell(c);
      cell.alignment = { wrapText: true, vertical: "top" };
      if (!cell.value) cell.value = "—";
    }
  };

  stakeholderField("Stakeholder Name", (s) => display(s?.name));
  stakeholderField("Designation",      (s) => display(s?.designation));
  stakeholderField("Mob No",           (s) => s?.mobile ? `+91 ${s.mobile}` : "");
  stakeholderField("Email ID",         (s) => display(s?.email));
  stakeholderField("PAN", (s) => {
    if (!s) return "";
    return hasPan.get(s.id) ? "uploaded ✓" : "—";
  });
  stakeholderField("Aadhar", (s) => {
    if (!s) return "";
    const legacy = hasAadhaarLegacy.get(s.id);
    const both = hasAadhaarFront.get(s.id) && hasAadhaarBack.get(s.id);
    if (both || legacy) return "uploaded ✓";
    const partial = hasAadhaarFront.get(s.id) || hasAadhaarBack.get(s.id);
    return partial ? "partial" : "—";
  });
  ws.addRow([]);

  // ── Bank Details ─────────────────────────────────────────────────
  sectionHeader("Bank Details");
  kv("Account Number", biz.bank_account_number);   // full/unmasked
  kv("IFSC",           biz.bank_ifsc);
  kv("Bank Name",      biz.bank_name);
  ws.addRow([]);

  // ── Other Details ────────────────────────────────────────────────
  sectionHeader("Other Details");
  kv("Total Team Size (Technical + Non-Technical)", adminInfo?.team_size);
  const capResi = adminInfo?.capacity_residential
    ? `${display(adminInfo.capacity_residential)} ${display(adminInfo?.capacity_residential_unit)}`.trim()
    : "";
  const capComm = adminInfo?.capacity_commercial
    ? `${display(adminInfo.capacity_commercial)} ${display(adminInfo?.capacity_commercial_unit)}`.trim()
    : "";
  kv("Installed Capacity (Resi.)",            capResi);
  kv("Installed Capacity (Comm.)",            capComm);
  kv("Last FY Turnover",                      adminInfo?.turnover_last_fy);
  kv("GST Turnover (Latest 12 Months)",
     `₹${r3bTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
  ws.addRow([]);

  // ── Reference Details ────────────────────────────────────────────
  // CreditFair variant: the entire References section is omitted.
  // Aerem + Solfin: full AEREM layout (Buyer 1/2 + Supplier 1/2).
  if (lender !== "creditfair") {
    sectionHeader("Reference Details");
    // Sub-header for the two-column layout inside this section: Name | Phone No
    const refHeader = ws.addRow(["", "Name", "Phone No", ...Array(totalCols - 3).fill("")]);
    refHeader.getCell(2).font = { bold: true, color: { argb: COLOR_MUTED } };
    refHeader.getCell(3).font = { bold: true, color: { argb: COLOR_MUTED } };
    if (totalCols > 3) ws.mergeCells(refHeader.number, 3, refHeader.number, totalCols);

    const refRow = (label: string, r: Reference) => {
      const row = ws.addRow([label, display(r.name), r.mobile ? `+91 ${r.mobile}` : "", ...Array(totalCols - 3).fill("")]);
      row.getCell(1).font = { bold: true, color: { argb: COLOR_LABEL } };
      row.getCell(2).alignment = { wrapText: true, vertical: "top" };
      row.getCell(3).alignment = { wrapText: true, vertical: "top" };
      if (!row.getCell(2).value) row.getCell(2).value = "—";
      if (!row.getCell(3).value) row.getCell(3).value = "—";
      if (totalCols > 3) ws.mergeCells(row.number, 3, row.number, totalCols);
    };

    refRow("Buyer 1",    buyer1 as Reference);
    refRow("Buyer 2",    buyer2 as Reference);
    refRow("Supplier 1", supplier1 as Reference);
    refRow("Supplier 2", supplier2 as Reference);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

// ── Manifest ─────────────────────────────────────────────────────────

type ManifestEntry =
  | { status: "INCLUDED"; category: string; storage_path: string; zip_path: string; size: number; file_name: string | null }
  | { status: "MISSING";  category: string; storage_path: string; zip_path: string; error: string; file_name: string | null };

// Builds a plain-text manifest listing every doc known to the DB and
// whether it made it into the ZIP. Format is designed for human eyes
// (grep-friendly, ~1 KB for a typical EPC).
function buildManifest(biz: Record<string, unknown>, lender: LenderKey, entries: ManifestEntry[]): Buffer {
  const generated = new Date().toISOString();
  const included = entries.filter((e) => e.status === "INCLUDED") as Extract<ManifestEntry, { status: "INCLUDED" }>[];
  const missing  = entries.filter((e) => e.status === "MISSING")  as Extract<ManifestEntry, { status: "MISSING"  }>[];
  const bytesTotal = included.reduce((s, e) => s + e.size, 0);

  const header = [
    `Capital Craft — Download ZIP manifest`,
    `Generated:      ${generated}`,
    `EPC:            ${display(biz.trade_name) || display(biz.legal_name) || display(biz.contact_name) || biz.id}`,
    `EPC UUID:       ${biz.id}`,
    `EPC Display ID: ${display(biz.epc_display_id) || "—"}`,
    `Lender:         ${LENDER_LABEL[lender]}`,
    `Documents:      ${entries.length} total · ${included.length} included · ${missing.length} missing`,
    `Included size:  ${bytesTotal} bytes`,
    ``,
    `Also in the ZIP root:`,
    `  summary.xlsx  — profile workbook in the AEREM template layout for ${LENDER_LABEL[lender]}`,
    ``,
    `─── INCLUDED (${included.length}) ─────────────────────────────────`,
  ];

  const inclLines = included.length === 0
    ? ["(none)"]
    : included.map((e) =>
        `INCLUDED  ${padRight(e.category, 32)}  ${padRight((e.file_name ?? "(unnamed)"), 40)}  ${e.size}B  ->  ${e.zip_path}`
      );

  const missLines = missing.length === 0
    ? ["(none)"]
    : missing.map((e) =>
        `MISSING   ${padRight(e.category, 32)}  ${padRight((e.file_name ?? "(unnamed)"), 40)}  storage_path=${e.storage_path}  error=${e.error}`
      );

  const tail = [
    ``,
    `─── MISSING (${missing.length}) ─────────────────────────────────`,
  ];

  const text =
    [...header, ...inclLines, ...tail, ...missLines, ""].join("\n");
  return Buffer.from(text, "utf-8");
}

function padRight(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}
