// GET /api/epc/[id]/download-zip
//
// Admin-only. Streams a fresh ZIP for the given EPC containing:
//   - summary.html            (self-contained profile snapshot, styled)
//   - documents/<category>/…  (pan_business, gstin, extra_doc, cancelled_cheque, office_*)
//   - documents/members/<Member N - name>/{pan,aadhaar}/…
//   - gst_r3b/…               (admin-only R3B files, prefixed by period-year)
//
// Response is streamed (archiver → Node Readable → Web ReadableStream) so the
// ZIP is never fully buffered — no Cloud Run 32MB response cap, no OOM risk on
// large document sets.
//
// Missing GCS files (row exists, object gone) are skipped and reported in the
// summary's "Missing files" table. Never crashes on individual failures.
//
// No caching — every request regenerates a fresh ZIP with current data.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import archiver from "archiver";
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

type LenderRow = {
  lender: string;
  docs_given: boolean;
  approved: boolean;
  updated_at: string;
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

    // ── Lender status (admin-only RLS) ────────────────────────────────
    const { data: lenderData } = await supabase
      .from("epc_lender_status")
      .select("lender, docs_given, approved, updated_at")
      .eq("business_id", params.id);
    const lender = (lenderData ?? []) as LenderRow[];

    // ── Admin info (Batch 1; may not exist yet) ───────────────────────
    // Best-effort — swallow errors so this works before/after Batch 1 lands.
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
    // level 3: JPEG/PDF barely compress, favor speed over ratio.
    const archive = archiver("zip", { zlib: { level: 3 } });

    // Log any low-level archive error (e.g. output stream closed by client).
    archive.on("warning", (e) => console.warn("[download-zip] archive warning:", e));
    archive.on("error",   (e) => console.error("[download-zip] archive error:", e));

    // Kick off appending in the background. We return the streaming Response
    // immediately below; the runtime keeps consuming the stream until finalize.
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

        const included: Array<{
          path: string; category: string; file_name: string; size: number | null;
        }> = [];
        const missing: Array<{
          category: string; file_name: string; storage_path: string; error: string;
        }> = [];

        // Download + append each doc.
        for (const doc of docs) {
          const zipPath = pathInZip(doc, memberLabelById);
          try {
            const buf = await downloadBuffer(doc.storage_path);
            archive.append(buf, {
              name: zipPath,
              date: doc.created_at ? new Date(doc.created_at) : undefined,
            });
            included.push({
              path: zipPath,
              category: doc.category,
              file_name: doc.file_name ?? "(unnamed)",
              size: doc.stored_size_bytes ?? null,
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(
              `[download-zip] missing/failed: ${doc.storage_path} — ${msg}`,
            );
            missing.push({
              category: doc.category,
              file_name: doc.file_name ?? "(unnamed)",
              storage_path: doc.storage_path,
              error: msg,
            });
          }
        }

        // Append the summary AFTER downloads — so its manifest reflects
        // what's actually in the ZIP.
        const html = renderSummaryHtml({
          biz: biz as Record<string, unknown>,
          docs, lender, adminInfo, included, missing,
        });
        archive.append(html, { name: "summary.html" });

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

// For the OUTER ZIP filename (safe across shells and file systems).
function sanitizeName(s: string): string {
  const trimmed = (s || "").replace(/[^\w\-]+/g, "_").slice(0, 60);
  return trimmed || "epc";
}

// For a SINGLE PATH SEGMENT inside the ZIP. Keeps spaces + hyphens + dots.
// Blocks path-traversal characters and control chars.
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

  if (doc.category === "stakeholder_pan" || doc.category === "stakeholder_aadhaar") {
    const label = doc.stakeholder_id
      ? (memberLabelById.get(doc.stakeholder_id) ??
         `Member (${doc.stakeholder_id.slice(0, 8)})`)
      : "Member (unknown)";
    const kind = doc.category === "stakeholder_pan" ? "pan" : "aadhaar";
    return `documents/members/${sanitizeSegment(label)}/${kind}/${fname}`;
  }

  return `documents/${sanitizeSegment(doc.category)}/${fname}`;
}

// ── HTML summary ──────────────────────────────────────────────────────

function esc(v: unknown): string {
  if (v === null || v === undefined) return "—";
  const s = String(v);
  if (!s.trim()) return "—";
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

function fmtDate(v: unknown): string {
  if (!v) return "—";
  try {
    return new Date(String(v)).toLocaleString("en-IN", {
      dateStyle: "medium", timeStyle: "short",
    });
  } catch {
    return String(v);
  }
}

function fmtBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const BUSINESS_TYPE_LABEL: Record<string, string> = {
  proprietorship: "Proprietorship",
  pvt_ltd:        "Private Limited",
  partnership:    "Partnership",
  llp:            "LLP",
};

function renderSummaryHtml(data: {
  biz: Record<string, unknown>;
  docs: Doc[];
  lender: LenderRow[];
  adminInfo: Record<string, unknown> | null;
  included: Array<{ path: string; category: string; file_name: string; size: number | null }>;
  missing: Array<{ category: string; file_name: string; storage_path: string; error: string }>;
}): string {
  const { biz, lender, adminInfo, included, missing } = data;

  const stakeholders = ((biz.stakeholders ?? []) as unknown[]).map(
    (s) => s as Stakeholder,
  );
  const refs = ((biz.business_references ?? []) as unknown[]).map(
    (r) => r as Reference,
  );
  const customers = refs.filter((r) => r.type === "customer");
  const suppliers = refs.filter((r) => r.type === "supplier");

  const btLabel = BUSINESS_TYPE_LABEL[(biz.business_type as string) ?? ""] ?? biz.business_type;

  const suryaGhar = biz.pm_surya_ghar as string | null;
  const suryaGharDisplay = suryaGhar === "other"
    ? `Other — ${esc(biz.pm_surya_ghar_other)}`
    : suryaGhar
      ? esc(suryaGhar.charAt(0).toUpperCase() + suryaGhar.slice(1))
      : "—";

  const now = new Date().toLocaleString("en-IN", {
    dateStyle: "medium", timeStyle: "short",
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>EPC profile — ${esc(biz.trade_name || biz.legal_name || biz.contact_name)}</title>
<style>
  * { box-sizing: border-box; }
  body { font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color: #1a1f2c; background: #f7f8fb; margin: 0; padding: 32px; }
  .wrap { max-width: 900px; margin: 0 auto; }
  header { border-bottom: 1px solid #d0d5dd; padding-bottom: 20px; margin-bottom: 24px; }
  h1 { font-size: 24px; margin: 0 0 4px; color: #0b1120; }
  h1 small { font-weight: 400; color: #667085; font-size: 13px; margin-left: 8px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #475467;
       margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #e4e7ec; }
  h3 { font-size: 13px; margin: 16px 0 6px; color: #344054; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; background: #fff;
          border: 1px solid #e4e7ec; border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #f2f4f7;
           font-size: 13px; vertical-align: top; }
  tr:last-child td { border-bottom: 0; }
  th { color: #667085; font-weight: 600; background: #f9fafb; width: 32%; }
  td.mono, .mono { font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px;
          font-weight: 600; background: #eff4ff; color: #1849a9; }
  .pill.warn { background: #fef3c7; color: #92400e; }
  .pill.danger { background: #fee4e2; color: #b42318; }
  .pill.ok { background: #d1fadf; color: #027a48; }
  .kv { display: grid; grid-template-columns: 200px 1fr; gap: 8px 16px; margin: 8px 0; }
  .kv dt { color: #667085; font-size: 13px; }
  .kv dd { margin: 0; color: #1a1f2c; font-size: 13px; }
  .muted { color: #98a2b3; }
  footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e4e7ec;
           color: #98a2b3; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>${esc(biz.trade_name || biz.legal_name || biz.contact_name)}
    <small>EPC profile snapshot · generated ${esc(now)}</small></h1>
  <div class="kv" style="margin-top:12px;">
    <dt>Status</dt><dd><span class="pill">${esc(biz.status)}</span>${biz.epc_self_edited ? ' <span class="pill warn">Updated</span>' : ""}</dd>
    <dt>Current step</dt><dd>${esc(biz.current_step)}</dd>
    <dt>Submitted</dt><dd>${esc(fmtDate(biz.submitted_at))}</dd>
    <dt>Created</dt><dd>${esc(fmtDate(biz.created_at))}</dd>
    <dt>Last updated</dt><dd>${esc(fmtDate(biz.updated_at))}</dd>
    <dt>EPC ID</dt><dd class="mono">${esc(biz.id)}</dd>
  </div>
</header>

<h2>Personal</h2>
<table>
  <tr><th>Point of contact</th><td>${esc(biz.contact_name)}</td></tr>
  <tr><th>Email</th><td>${esc(biz.contact_email)}</td></tr>
  <tr><th>Mobile (login)</th><td>+91 ${esc(biz.contact_mobile)}</td></tr>
  <tr><th>Designation</th><td>${esc(biz.contact_designation)}</td></tr>
</table>

<h2>Business</h2>
<table>
  <tr><th>Legal name</th><td>${esc(biz.legal_name)}</td></tr>
  <tr><th>Trade name</th><td>${esc(biz.trade_name)}</td></tr>
  <tr><th>Business type</th><td>${esc(btLabel)}</td></tr>
  <tr><th>PAN</th><td class="mono">${esc(biz.pan_number)}</td></tr>
  <tr><th>PM Surya Ghar Yojana</th><td>${suryaGharDisplay}</td></tr>
</table>

<h2>Bank</h2>
<table>
  <tr><th>Account holder</th><td>${esc(biz.bank_account_holder)}</td></tr>
  <tr><th>Account number</th><td class="mono">${esc(biz.bank_account_number)}</td></tr>
  <tr><th>IFSC</th><td class="mono">${esc(biz.bank_ifsc)}</td></tr>
  <tr><th>Bank name</th><td>${esc(biz.bank_name)}</td></tr>
  <tr><th>Branch</th><td>${esc(biz.bank_branch)}</td></tr>
</table>

<h2>Members (${stakeholders.length})</h2>
${stakeholders.length === 0 ? '<p class="muted">No members recorded.</p>' : `
<table>
  <thead>
    <tr><th style="width:auto;">Name</th><th>Designation</th><th>Mobile</th><th>Email</th></tr>
  </thead>
  <tbody>
    ${stakeholders.map((s) => `
      <tr>
        <td>${esc(s.name)}</td>
        <td>${esc(s.designation)}</td>
        <td>${s.mobile ? "+91 " + esc(s.mobile) : "—"}</td>
        <td>${esc(s.email)}</td>
      </tr>
    `).join("")}
  </tbody>
</table>`}

<h2>References (${refs.length})</h2>
${refs.length === 0 ? '<p class="muted">No references recorded.</p>' : `
${customers.length > 0 ? `
<h3>Customer (${customers.length})</h3>
<table><thead><tr><th style="width:auto;">Name</th><th>Mobile</th></tr></thead>
  <tbody>${customers.map((r) => `<tr><td>${esc(r.name)}</td><td>+91 ${esc(r.mobile)}</td></tr>`).join("")}</tbody>
</table>` : ""}
${suppliers.length > 0 ? `
<h3>Supplier (${suppliers.length})</h3>
<table><thead><tr><th style="width:auto;">Name</th><th>Mobile</th></tr></thead>
  <tbody>${suppliers.map((r) => `<tr><td>${esc(r.name)}</td><td>+91 ${esc(r.mobile)}</td></tr>`).join("")}</tbody>
</table>` : ""}`}

${adminInfo ? `
<h2>Admin business info</h2>
<table>
  <tr><th>Team size</th><td>${esc(adminInfo.team_size)}</td></tr>
  <tr><th>Installed capacity (Residential)</th>
      <td>${esc(adminInfo.capacity_residential)} ${esc(adminInfo.capacity_residential_unit)}</td></tr>
  <tr><th>Installed capacity (Commercial)</th>
      <td>${esc(adminInfo.capacity_commercial)} ${esc(adminInfo.capacity_commercial_unit)}</td></tr>
  <tr><th>Turnover (last FY)</th><td>${esc(adminInfo.turnover_last_fy)}</td></tr>
</table>` : ""}

<h2>Lender status <span class="muted" style="font-size:11px; text-transform:none;">(admin-only)</span></h2>
${lender.length === 0 ? '<p class="muted">No lender rows.</p>' : `
<table>
  <thead><tr><th style="width:auto;">Lender</th><th>Docs given</th><th>Approved</th><th>Updated</th></tr></thead>
  <tbody>
    ${lender.map((l) => `
      <tr>
        <td>${esc(l.lender)}</td>
        <td>${l.docs_given ? '<span class="pill ok">Yes</span>' : '<span class="pill">No</span>'}</td>
        <td>${l.approved   ? '<span class="pill ok">Yes</span>' : '<span class="pill">No</span>'}</td>
        <td>${esc(fmtDate(l.updated_at))}</td>
      </tr>`).join("")}
  </tbody>
</table>`}

<h2>Documents included (${included.length})</h2>
${included.length === 0 ? '<p class="muted">No documents included.</p>' : `
<table>
  <thead>
    <tr><th style="width:auto;">Category</th><th>File</th><th>Size</th><th>Path in ZIP</th></tr>
  </thead>
  <tbody>
    ${included.map((f) => `
      <tr>
        <td>${esc(f.category)}</td>
        <td>${esc(f.file_name)}</td>
        <td>${esc(fmtBytes(f.size))}</td>
        <td class="mono">${esc(f.path)}</td>
      </tr>`).join("")}
  </tbody>
</table>`}

${missing.length > 0 ? `
<h2>Missing files (${missing.length}) <span class="pill danger">Attention</span></h2>
<p class="muted" style="margin-top:0;">These document rows exist in the database but the underlying GCS object was
  not found or unreadable. Nothing was crashed; the summary above reflects only what was successfully archived.</p>
<table>
  <thead><tr><th style="width:auto;">Category</th><th>File</th><th>Storage path</th><th>Error</th></tr></thead>
  <tbody>
    ${missing.map((f) => `
      <tr>
        <td>${esc(f.category)}</td>
        <td>${esc(f.file_name)}</td>
        <td class="mono">${esc(f.storage_path)}</td>
        <td class="mono">${esc(f.error)}</td>
      </tr>`).join("")}
  </tbody>
</table>` : ""}

<footer>
  Capital Craft &middot; admin export &middot; ${esc(now)}
</footer>

</div>
</body>
</html>`;
}
