// POST /api/admin/epc/[id]/send-to-lender
//
// EPC twin of the loan send-to-lender route. Same two modes ("preview" / "send"),
// same editable-detail + document-pack + summary format. Sent FROM
// capitalcraftadvisors@gmail.com with Manishfrthanvi@gmail.com in CC by default
// (the EPC desk is managed by Manish). Admin-only. Keeps Download-ZIP untouched.
// The team can't send while the profile waits for the main admin's check (0100).

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { epcSummaryRows } from "@/lib/lender-summary";
import { fetchLenders, lenderLabelIn } from "@/lib/loan-lenders";
import { esc, readSendFields, sendLenderPack, titleCaseCategory, type ComposerBody } from "@/lib/lender-pack";
import { errText } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const EPC_CC_DEFAULT = ["Manishfrthanvi@gmail.com".toLowerCase()];

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await requireLogin(req, { role: "admin" });
    if (auth instanceof Response) return auth;
    const { token, claims } = auth;

    const bizId = params.id;
    if (!UUID_RE.test(bizId)) return err("Invalid EPC id.", 400);

    const body = (await req.json().catch(() => ({}))) as ComposerBody;
    const mode = body.mode === "send" ? "send" : "preview";
    const lender = String(body.lender ?? "").toLowerCase();

    const supabase = dbAs(token);
    // Any lender the portal works with (the registry) — not a fixed list.
    const lenders = await fetchLenders(supabase);
    if (!lenders.some((l) => l.key === lender)) return err("Pick a lender.", 400);

    const [{ data: epc, error: loadErr }, { data: docRows }] = await Promise.all([
      supabase.from("epc_business").select("*").eq("id", bizId).maybeSingle(),
      supabase.from("epc_documents").select("category, storage_path, file_name").eq("business_id", bizId),
    ]);
    if (loadErr) return err(loadErr.message, 500);
    if (!epc) return err("EPC not found.", 404);
    // A profile the team approved waits for the main admin's check (Pendings).
    const team = !!claims.hierarchy_role && claims.hierarchy_role !== "MAIN_ADMIN";
    if (team && epc.admin_review_status === "pending") return err("This profile is waiting for admin approval.", 403);

    const epcName: string = epc.trade_name || epc.legal_name || epc.contact_name || "EPC";
    const seen = new Set<string>();
    const docList: Array<{ label: string; path: string }> = [];
    for (const d of (docRows ?? []) as Array<{ category: string; storage_path: string }>) {
      if (!d.storage_path || seen.has(d.storage_path)) continue;
      seen.add(d.storage_path); docList.push({ label: titleCaseCategory(d.category), path: d.storage_path });
    }

    if (mode === "preview") {
      return NextResponse.json({
        ok: true,
        subject: `EPC Onboarding Application _${epcName}`,
        toName: "",
        detail: epcSummaryRows(epc),
        docLabels: docList.map((d) => d.label),
        ccDefault: EPC_CC_DEFAULT,
        bccDefault: [],
      });
    }

    const mail = readSendFields(body, `EPC Onboarding Application _${epcName}`, epcSummaryRows(epc));
    if (mail instanceof Response) return mail;
    const { to } = mail;
    const documents = await sendLenderPack(req, supabase, {
      mail,
      sheetName: "EPC",
      sheetTitle: "Capital Craft — EPC Partner",
      docs: docList,
      name: epcName,
      lenderLabel: lenderLabelIn(lenders, lender),
      zipFolder: `epc-lender-packs/${bizId}`,
      introHtml: `Please find the EPC partner details for <b>${esc(epcName)}</b> below, along with the supporting documents. Kindly review and revert at the earliest.`,
      logTag: "epc-send",
    });

    // Record the send in the EPC's activity log (best-effort; the mail already went).
    try {
      await supabase.from("admin_edit_log").insert({
        business_id: bizId, actor: "admin", actor_id: claims.business_id ?? null,
        action: "email_sent", field: lender, new_value: to,
      });
    } catch (e) { console.warn("[epc-send-to-lender] activity log failed:", e); }
    return NextResponse.json({ ok: true, sent_to: to, documents });
  } catch (e) {
    const msg = errText(e);
    console.error("[epc-send-to-lender] error:", msg);
    return err(msg, 500);
  }
}
