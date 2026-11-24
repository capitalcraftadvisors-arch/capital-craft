// A project's document vault (Partner Portal v2, lib/project-docs).
//   GET  ?project=<id>              → { ok, files: [{ group, name, url, id?, deletable }] }
//        its site photos, its documents (epc_project_documents) and — not for Site
//        staff — its loan's documents from both stores; 1-hour links. One read.
//   POST ?project=<id>&share=photos → { ok, links } 90-day portal links (lib/file-links)
//        to its latest site photos (up to 6) for the customer's WhatsApp update.
//        Paid: only with WhatsApp switched on for the EPC (epc_has_feature, 0129).
// Everything goes through the caller's token: the project rules (RLS) decide who
// may see what — Site staff only the projects given to them.

import { NextRequest, NextResponse } from "next/server";
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { getSignedReadUrl } from "@/lib/gcs";
import { fileLinkUrl } from "@/lib/file-links";
import { publicOrigin } from "@/lib/login-password-server";
import { SUBSCRIPTION_MSG } from "@/lib/subscription";
import { vaultEntries, vaultViewer } from "@/lib/project-docs";
import { errText } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SHARE_PHOTOS = 6;

export async function GET(req: NextRequest) {
  try {
    const who = await requireLogin(req);
    if (who instanceof Response) return who;
    const id = req.nextUrl.searchParams.get("project") || "";
    if (!UUID_RE.test(id)) return err("not_found", 404);
    const v = await vaultEntries(dbAs(who.token), id, vaultViewer(who.claims));
    if (!v) return err("not_found", 404);
    const files = await Promise.all(v.entries.map(async (e) => ({
      group: e.group, name: e.name, ...(e.id ? { id: e.id } : {}), deletable: e.deletable,
      url: await getSignedReadUrl(e.path, 3600).catch(() => ""),
    })));
    return NextResponse.json({ ok: true, files });
  } catch (e) {
    const msg = errText(e);
    console.error("[epc/project-docs] error:", msg);
    return err("Couldn't load the documents.", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const who = await requireLogin(req);
    if (who instanceof Response) return who;
    const id = req.nextUrl.searchParams.get("project") || "";
    if (!UUID_RE.test(id) || req.nextUrl.searchParams.get("share") !== "photos") return err("not_found", 404);
    if (who.claims.member_role === "VIEWER") return err("You don't have access to share this project.", 403);
    const db = dbAs(who.token);
    const [{ data: on }, { data: p }] = await Promise.all([
      db.rpc("epc_has_feature", { p_business: who.claims.business_id, p_feature: "whatsapp" }),
      db.from("epc_projects").select("photos").eq("id", id).maybeSingle(),
    ]);
    if (on !== true) return err(SUBSCRIPTION_MSG, 403);
    if (!p) return err("not_found", 404);
    const photos = [...((p.photos ?? []) as { path: string; at?: string | null }[])]
      .sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")))
      .slice(-SHARE_PHOTOS);
    if (!photos.length) return err("Add site photos first.");
    const origin = publicOrigin(req);
    return NextResponse.json({ ok: true, links: photos.map((x) => fileLinkUrl(origin, x.path)) });
  } catch (e) {
    const msg = errText(e);
    console.error("[epc/project-docs share] error:", msg);
    return err("Couldn't share the photos.", 500);
  }
}
