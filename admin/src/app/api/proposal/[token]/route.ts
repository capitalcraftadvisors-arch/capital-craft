// /api/proposal/<token> — the customer's proposal page (/p/<token>), PUBLIC by
// design: the customer has no login; the 32-character token is the permission.
//   GET  → what the proposal shows (epc_proposal_get, 0129 — marks it seen) +
//          a fresh 90-day link to the quotation PDF.
//   POST { name } → the customer accepts (epc_proposal_accept): the quotation
//          becomes Accepted and a project starts, once. Not after the validity.
// Anonymous Supabase client: the two functions are the only way in.

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { SUPABASE_ANON, SUPABASE_URL } from "@/lib/insurance-server";
import { fileLinkUrl } from "@/lib/file-links";
import { publicOrigin } from "@/lib/login-password-server";
import { PROPOSAL_TOKEN_RE, type ProposalSnapshot, type PublicProposal } from "@/lib/proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = "This proposal is not available.";

function err(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
const ok = (body: object) => NextResponse.json({ ok: true, ...body }, { headers: { "Cache-Control": "no-store" } });

const anon = () => createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false, autoRefreshToken: false } });

type Got = { snapshot: ProposalSnapshot; pdf_path: string | null; accepted_at: string | null; accepted_name: string | null };

async function read(token: string): Promise<Got | null> {
  const { data, error } = await anon().rpc("epc_proposal_get", { p_token: token });
  if (error) throw new Error(error.message);
  return (data as Got | null) ?? null;
}

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  if (!PROPOSAL_TOKEN_RE.test(params.token)) return err(NOT_FOUND, 404);
  try {
    const p = await read(params.token);
    if (!p?.snapshot) return err(NOT_FOUND, 404);
    const { mobile: _mobile, ...snapshot } = p.snapshot; // the page never shows it
    const body: PublicProposal = {
      snapshot, accepted_at: p.accepted_at, accepted_name: p.accepted_name,
      pdf: p.pdf_path ? fileLinkUrl(publicOrigin(req), p.pdf_path) : null,
    };
    return ok(body);
  } catch (e) {
    console.error("[proposal] get:", e instanceof Error ? e.message : e);
    return err("Couldn't open this proposal. Please try again.", 500);
  }
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  if (!PROPOSAL_TOKEN_RE.test(params.token)) return err(NOT_FOUND, 404);
  const b = (await req.json().catch(() => ({}))) as { name?: unknown };
  const name = String(b?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) return err("Enter your name.");
  try {
    // Past its validity it can still be read, not accepted (the database refuses it: 'expired').
    const { data, error } = await anon().rpc("epc_proposal_accept", { p_token: params.token, p_name: name });
    if (error) {
      if (/not_found/.test(error.message)) return err(NOT_FOUND, 404);
      if (/expired/.test(error.message)) return err("This proposal has expired.", 410);
      if (/name_required/.test(error.message)) return err("Enter your name.");
      console.error("[proposal] accept:", error.message);
      return err("Couldn't accept the proposal. Please try again.", 500);
    }
    const r = (data ?? {}) as { accepted_at?: string | null; accepted_name?: string | null };
    return ok({ accepted_at: r.accepted_at ?? null, accepted_name: r.accepted_name ?? null });
  } catch (e) {
    console.error("[proposal] accept:", e instanceof Error ? e.message : e);
    return err("Couldn't accept the proposal. Please try again.", 500);
  }
}
