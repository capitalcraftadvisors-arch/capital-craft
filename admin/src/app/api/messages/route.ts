// POST /api/messages — the "Message to EPC" thread actions (admin ⇄ EPC), for
// both loan and insurance profiles. Reads happen client-side under RLS; every
// WRITE goes through here so the side-effects stay server-side and trustworthy:
//   • send    → insert a message (sender inferred from the token; author_name
//               looked up server-side) + flip the parent's attention state.
//   • edit    → edit own message (adds an "(edited)" marker).
//   • delete  → delete own message.
//   • resolve → mark the profile's attention resolved.
//   • reopen  → re-open a resolved profile.
//   • seen    → record that this side opened the thread (read receipt).
// All DB access uses the CALLER's token — RLS scopes every write to the admin
// (all) or the owning EPC (own profiles / own messages).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getBearerToken, verifyJwt } from "@/lib/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://hpebydmrpimyuxgsgtmu.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwZWJ5ZG1ycGlteXV4Z3NndG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzI3OTUsImV4cCI6MjA5NjY0ODc5NX0.VRhdmxA9YfBAkpDwOXpnvlX0JDBUfzUUJzs1HM8VPqE";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CFG = {
  loan:      { msgTable: "loan_messages",      parentTable: "epc_applications",       fk: "application_id" },
  insurance: { msgTable: "insurance_messages", parentTable: "insurance_applications", fk: "insurance_application_id" },
} as const;
type Kind = keyof typeof CFG;

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}
function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (!claims.business_id) return err("unauthorized", 401);
    const isAdmin = claims.business_type === "admin";
    const sender: "admin" | "epc" = isAdmin ? "admin" : "epc";

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(b.action ?? "");
    const kind = String(b.kind ?? "") as Kind;
    if (!CFG[kind]) return err("bad_kind", 400);
    const { msgTable, parentTable, fk } = CFG[kind];

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const now = new Date().toISOString();

    // ── edit / delete operate on a single message (RLS enforces ownership) ────
    if (action === "edit") {
      const messageId = String(b.message_id ?? "");
      if (!UUID_RE.test(messageId)) return err("bad_message_id", 400);
      const { error } = await supabase.from(msgTable).update({
        body: strOrNull(b.body),
        attachments: Array.isArray(b.attachments) ? b.attachments : [],
        doc_tags: Array.isArray(b.doc_tags) ? (b.doc_tags as unknown[]).filter((x): x is string => typeof x === "string") : [],
        edited_at: now,
      }).eq("id", messageId);
      if (error) return err(error.message, 403);
      return NextResponse.json({ ok: true });
    }
    if (action === "delete") {
      const messageId = String(b.message_id ?? "");
      if (!UUID_RE.test(messageId)) return err("bad_message_id", 400);
      const { error } = await supabase.from(msgTable).delete().eq("id", messageId);
      if (error) return err(error.message, 403);
      return NextResponse.json({ ok: true });
    }

    // Everything else needs the parent id.
    const parentId = String(b.id ?? "");
    if (!UUID_RE.test(parentId)) return err("bad_id", 400);

    if (action === "seen") {
      const col = isAdmin ? "msg_admin_seen_at" : "msg_epc_seen_at";
      await supabase.from(parentTable).update({ [col]: now }).eq("id", parentId);
      // Per-admin read state (0086): THIS admin has seen this profile's updates,
      // so its red count clears on their console only (others still see it).
      if (isAdmin) {
        await supabase.from("epc_msg_reads").upsert(
          { admin_id: claims.business_id, kind, parent_id: parentId, seen_at: now },
          { onConflict: "admin_id,kind,parent_id" },
        );
      }
      return NextResponse.json({ ok: true });
    }
    if (action === "resolve") {
      const patch: Record<string, unknown> = { attention_status: "resolved", attention_resolved_at: now, attention_resolved_by: sender };
      if (sender === "epc") patch.epc_last_activity_at = now; // surfaces to admin as an unseen update
      if (kind === "loan") patch.edit_allow = []; // a resolved issue closes the edit grant
      const { error } = await supabase.from(parentTable).update(patch).eq("id", parentId);
      if (error) return err(error.message, 403);
      return NextResponse.json({ ok: true });
    }
    if (action === "reopen") {
      const { error } = await supabase.from(parentTable).update({
        attention_status: "open", attention_raised_at: now, attention_resolved_at: null, attention_resolved_by: null,
      }).eq("id", parentId);
      if (error) return err(error.message, 403);
      return NextResponse.json({ ok: true });
    }

    if (action === "send") {
      const body = strOrNull(b.body);
      const attachments = Array.isArray(b.attachments) ? b.attachments : [];
      if (!body && attachments.length === 0) return err("empty_message", 400);
      // Display name: the person for admins, the business for EPCs.
      let authorName: string | null = null;
      const { data: biz } = await supabase
        .from("epc_business")
        .select("trade_name, legal_name, contact_name")
        .eq("id", claims.business_id)
        .maybeSingle();
      if (biz) {
        const bz = biz as Record<string, string | null>;
        authorName = isAdmin
          ? (bz.contact_name || bz.trade_name || bz.legal_name || "Capital Craft")
          : (bz.trade_name || bz.legal_name || bz.contact_name || "EPC");
      }
      const { data: inserted, error } = await supabase.from(msgTable).insert({
        [fk]: parentId,
        sender,
        author_id: claims.business_id,
        author_name: authorName,
        body,
        attachments,
        doc_tags: Array.isArray(b.doc_tags) ? (b.doc_tags as unknown[]).filter((x): x is string => typeof x === "string") : [],
      }).select("id").single();
      if (error) return err(error.message, 403);

      // Side-effects: an admin message raises attention (and is unseen by the
      // EPC); an EPC reply is unseen by the admin. Best-effort — the message is
      // already saved.
      if (isAdmin) {
        const patch: Record<string, unknown> = {
          attention_status: "open", attention_raised_at: now, attention_resolved_at: null,
          attention_resolved_by: null, msg_epc_seen_at: null,
        };
        // Loan: the ticked edit-table rows OPEN editing for the EPC (the grant).
        // Accumulate across messages; the resubmit/resolve clears it (0085).
        const tags = Array.isArray(b.doc_tags) ? (b.doc_tags as unknown[]).filter((x): x is string => typeof x === "string") : [];
        if (kind === "loan" && tags.length) {
          const { data: cur } = await supabase.from(parentTable).select("edit_allow").eq("id", parentId).maybeSingle();
          const prev = Array.isArray((cur as { edit_allow?: unknown })?.edit_allow) ? ((cur as { edit_allow: string[] }).edit_allow) : [];
          patch.edit_allow = [...new Set([...prev, ...tags])];
        }
        await supabase.from(parentTable).update(patch).eq("id", parentId);
      } else {
        // EPC reply → surfaces to the admin console as an unseen update.
        await supabase.from(parentTable).update({ epc_last_activity_at: now }).eq("id", parentId);
      }
      return NextResponse.json({ ok: true, id: (inserted as { id: string })?.id });
    }

    return err("unknown_action", 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[messages] error:", msg);
    return err(msg, 500);
  }
}
