// POST /api/admin/loan-app/[id]/insurance
//
// Makes the insurance profile of a loan application from what the loan
// already has — nothing is typed again — or, when the loan has one, fills in
// only what that profile is still missing (never overwrites). Returns its id.
//   applicant  PAN number + PAN card · Aadhaar details + front/back ·
//              applicant address (Aadhaar)
//   plant      plant address (electricity-bill address, else the installation
//              address) · electricity bill · plant photo = the 2nd-tranche
//              "customer with panel" photo and its GPS, once uploaded
//   invoice    the tax invoice if uploaded, else the quotation; sum insured =
//              the amount read off the tax invoice, else the quotation's
//              project cost (remove the quotation in the insurance profile and
//              press Insurance again to switch to a tax invoice uploaded later)
// Files are COPIED into the insurance folder, so deleting one never breaks the
// other. One profile per loan (epc_applications.insurance_application_id,
// 0112); a new one goes straight to under_review, assigned to the admin.
// Admin only; reads / writes run under the caller's JWT (RLS).

import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { downloadBuffer, uploadBuffer, deleteObject } from "@/lib/gcs";
import { geminiExtractInvoice } from "@/lib/doc-extractors";
import { insuranceClient, safeName, UUID_RE } from "@/lib/insurance-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Row = Record<string, any>;
type Doc = { category: string; storage_path: string; file_name: string | null; mime_type: string | null; metadata: Row | null };

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}
const mimeOf = (path: string, mime?: string | null) => mime || (/\.pdf$/i.test(path) ? "application/pdf" : "image/jpeg");
const blank = (v: unknown) => v == null || v === "";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const copied: string[] = [];
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);
    if (!UUID_RE.test(params.id)) return err("Invalid application id.", 400);
    const db = insuranceClient(token);

    const { data: loan } = await db.from("epc_applications").select("*").eq("id", params.id).maybeSingle();
    if (!loan) return err("Loan application not found.", 404);
    const l = loan as Row;
    if (!l.epc_business_id) return err("This application has no EPC.", 400);

    const { data: docRows } = await db.from("user_application_docs")
      .select("category, storage_path, file_name, mime_type, metadata")
      .eq("application_id", l.id)
      .in("category", ["borrower_pan", "completion_invoice", "completion_panel_photo", "quotation"])
      .order("created_at", { ascending: false });
    const latest = (cat: string) => ((docRows ?? []) as Doc[]).find((d) => d.category === cat) ?? null;

    let ins: Row | null = null;
    if (l.insurance_application_id) {
      const { data } = await db.from("insurance_applications").select("*").eq("id", l.insurance_application_id).maybeSingle();
      ins = (data as Row) ?? null;
    }
    const insId: string = ins?.id ?? crypto.randomUUID();
    const missing = (col: string) => !ins || blank(ins[col]);

    // Copy one stored file into this insurance profile's folder.
    async function copy(src: string | null | undefined, kind: string, fileName?: string | null, mime?: string | null): Promise<{ path: string; buf: Buffer; mime: string } | null> {
      if (!src) return null;
      const buf = await downloadBuffer(src);
      const m = mimeOf(src, mime);
      const path = `insurance/${insId}/${kind}/${Date.now()}_${safeName(fileName || src.split("/").pop() || kind, kind)}`;
      await uploadBuffer(path, buf, m);
      copied.push(path);
      return { path, buf, mime: m };
    }

    const patch: Row = {};
    const set = (col: string, v: unknown) => { if (missing(col) && !blank(v)) patch[col] = v; };

    // Applicant
    set("pan_number", l.borrower_pan);
    for (const k of ["aadhaar_name", "aadhaar_dob", "aadhaar_gender", "aadhaar_number", "aadhaar_number_masked", "aadhaar_care_of", "aadhaar_address"]) set(k, l[k]);
    if (missing("pan_path")) { const pan = latest("borrower_pan"); const c = await copy(pan?.storage_path, "pan", pan?.file_name, pan?.mime_type); if (c) patch.pan_path = c.path; }
    if (missing("aadhaar_front_path")) { const c = await copy(l.aadhaar_front_path, "aadhaar_front"); if (c) patch.aadhaar_front_path = c.path; }
    if (missing("aadhaar_back_path")) { const c = await copy(l.aadhaar_back_path, "aadhaar_back"); if (c) patch.aadhaar_back_path = c.path; }

    // Plant
    const installAddr = l.install_address || [l.install_city, l.install_district, l.install_state, l.install_pincode].filter(Boolean).join(", ");
    set("plant_address", l.ebill_address_line || installAddr);
    if (missing("ebill_path")) { const c = await copy(l.ebill_path, "ebill"); if (c) patch.ebill_path = c.path; }
    if (missing("plant_photo_path")) {
      const panel = latest("completion_panel_photo");
      const c = await copy(panel?.storage_path, "plant", panel?.file_name, panel?.mime_type);
      if (c) { patch.plant_photo_path = c.path; if (panel?.metadata?.gps) patch.plant_photo_gps = panel.metadata.gps; }
    }

    // Invoice: the tax invoice, else the quotation.
    if (missing("invoice_path")) {
      const tax = latest("completion_invoice");
      const quote = l.proforma_invoice_path ? { storage_path: l.proforma_invoice_path, file_name: null, mime_type: null } : latest("quotation");
      const src = tax ?? quote;
      const c = await copy(src?.storage_path, "invoice", src?.file_name, src?.mime_type);
      if (c) {
        patch.invoice_path = c.path;
        let amount: number | null = null;
        if (tax) {
          const g = await geminiExtractInvoice([{ buffer: c.buf, mime: c.mime }]).catch(() => null);
          amount = g?.amount != null && Number(g.amount) > 0 ? Math.round(Number(g.amount)) : null;
        }
        if (amount == null && Number(l.total_project_cost) > 0) amount = Math.round(Number(l.total_project_cost));
        // The amounts belong to the invoice just filled in (e.g. the quotation
        // was removed so the tax invoice could take its place).
        if (amount != null) Object.assign(patch, { invoice_amount: amount, invoice_confirmed_amount: amount, sum_insured: amount });
      }
    }

    const now = new Date().toISOString();
    if (!ins) {
      const { error: insErr } = await db.from("insurance_applications").insert({
        id: insId,
        epc_business_id: l.epc_business_id,
        status: "under_review",
        current_step: 3,
        created_by: "admin",
        created_by_user_id: claims.business_id,
        assigned_to_user_id: claims.business_id,
        last_updated_by_user_id: claims.business_id,
        step1_completed_at: now,
        step2_completed_at: now,
        submitted_at: now,
        ...patch,
      });
      if (insErr) { for (const p of copied) await deleteObject(p).catch(() => {}); return err(insErr.message, 500); }
      const { error: linkErr } = await db.from("epc_applications").update({ insurance_application_id: insId }).eq("id", l.id);
      if (linkErr) return err(`Insurance made, but couldn't link it to the loan: ${linkErr.message}`, 500);
      return NextResponse.json({ ok: true, id: insId, created: true });
    }

    if (Object.keys(patch).length) {
      const { error: updErr } = await db.from("insurance_applications")
        .update({ ...patch, last_updated_by_user_id: claims.business_id }).eq("id", insId);
      if (updErr) { for (const p of copied) await deleteObject(p).catch(() => {}); return err(updErr.message, 500); }
    }
    return NextResponse.json({ ok: true, id: insId, created: false, filled: Object.keys(patch) });
  } catch (e) {
    for (const p of copied) await deleteObject(p).catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[loan-app/insurance] error:", msg);
    return err(msg, 500);
  }
}
