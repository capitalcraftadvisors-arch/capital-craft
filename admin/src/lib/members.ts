// An EPC's staff logins (epc_members, 0119) — the Users & roles page. RLS lets
// the owner / an admin manage them; passwords go through set_member_password
// (a hash, plus a copy only the CC main admin reads on Stakeholders → EPCs, 0142).

import { supabase } from "./supabase";
import { authHeaders } from "./auth";
import type { EpcModule, StaffRole } from "./epc-roles";

export type MemberRow = {
  id: string; name: string; mobile: string; email: string | null;
  member_role: StaffRole; modules: EpcModule[]; active: boolean;
  last_login_at: string | null; created_at: string;
};
const COLS = "id, name, mobile, email, member_role, modules, active, last_login_at, created_at";

// Database refusals → plain words.
function friendly(e: { code?: string; message?: string } | null): Error {
  const m = e?.message || "";
  if (e?.code === "23505" || /mobile_in_use|duplicate key/.test(m)) return new Error("This mobile number already has a login.");
  if (/password_not_strong/.test(m)) return new Error("Use at least 8 characters with a letter and a number.");
  if (/admin_only_by_owner/.test(m)) return new Error("Only the owner can add or change an admin.");
  if (/cannot_change_own_access/.test(m)) return new Error("You can't change your own access.");
  if (/not_allowed|row-level security|42501/.test(m) || e?.code === "42501") return new Error("You don't have access to do this.");
  return new Error(m || "Something went wrong.");
}

export async function fetchMembers(): Promise<MemberRow[]> {
  const { data, error } = await supabase().from("epc_members").select(COLS).order("created_at");
  if (error) throw friendly(error);
  return (data ?? []) as MemberRow[];
}

export async function addMember(businessId: string, m: Pick<MemberRow, "name" | "mobile" | "email" | "member_role" | "modules">): Promise<MemberRow> {
  const { data, error } = await supabase().from("epc_members").insert({ business_id: businessId, ...m }).select(COLS).single();
  if (error) throw friendly(error);
  return data as MemberRow;
}

export async function updateMember(id: string, patch: Partial<Pick<MemberRow, "name" | "mobile" | "email" | "member_role" | "modules" | "active">>): Promise<MemberRow> {
  const { data, error } = await supabase().from("epc_members").update(patch).eq("id", id).select(COLS).single();
  if (error) throw friendly(error);
  return data as MemberRow;
}

export async function removeMember(id: string) {
  const { error } = await supabase().from("epc_members").delete().eq("id", id);
  if (error) throw friendly(error);
}

/** Emails a member its password from the Capital Craft Gmail (saved again first, so it's the one that works). */
export async function emailMemberPassword(id: string, email: string, password: string): Promise<{ ok: boolean; sentTo?: string; error?: string }> {
  const res = await fetch(`/api/epc/members/${id}/password-email`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ email, password }),
  });
  const d = await res.json().catch(() => ({}));
  return res.ok && d?.ok ? { ok: true, sentTo: d.sentTo } : { ok: false, error: d?.error || `HTTP ${res.status}` };
}

/** Sets a member's password (to be changed at its first login). */
export async function setMemberPassword(id: string, password: string) {
  const { error } = await supabase().rpc("set_member_password", { p_member_id: id, p_password: password });
  if (error) throw friendly(error);
}
