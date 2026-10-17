// Other Insurance (migration 0093) — general (non-solar) insurance files,
// main admin only. Client wrappers around /api/admin/other-insurance/[id]/*.

import { getToken } from "./auth";

export type KycDoc = { path: string; name: string; mime: string };

/** list-cache key of the console's Other Insurance table. */
export const OTHER_INS_LIST_CACHE = "dash.otherins";

const auth = () => ({ Authorization: `Bearer ${getToken() ?? ""}` });

/** Upload a KYC document (appended) or the policy document (replaces). */
export async function uploadOtherInsDoc(id: string, kind: "kyc" | "policy", file: File): Promise<{ ok: boolean; error?: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  const res = await fetch(`/api/admin/other-insurance/${id}/upload`, { method: "POST", headers: auth(), body: form });
  const d = await res.json().catch(() => ({}));
  return res.ok && d?.ok ? { ok: true } : { ok: false, error: d?.error || `HTTP ${res.status}` };
}

/** Signed view URL for one of the file's documents, or removes it. */
export async function otherInsDoc(id: string, path: string, action: "sign" | "delete"): Promise<{ ok: boolean; url?: string; error?: string }> {
  const res = await fetch(`/api/admin/other-insurance/${id}/doc`, {
    method: "POST",
    headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify({ path, action }),
  });
  const d = await res.json().catch(() => ({}));
  return res.ok && d?.ok ? { ok: true, url: d.url } : { ok: false, error: d?.error || `HTTP ${res.status}` };
}

/** Deletes the whole file (row + its stored documents). */
export async function deleteOtherIns(id: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/admin/other-insurance/${id}`, { method: "DELETE", headers: auth() });
  const d = await res.json().catch(() => ({}));
  return res.ok && d?.ok ? { ok: true } : { ok: false, error: d?.error || `HTTP ${res.status}` };
}
