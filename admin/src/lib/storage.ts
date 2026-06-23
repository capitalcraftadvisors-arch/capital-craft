// Client-side wrappers around the Next.js API routes.
// The actual work (compression, GCS upload, signed URLs) happens on the server
// in /api/upload and /api/document/[id].

import { getToken } from "./auth";

type UploadMeta = {
  table: "epc_documents" | "user_application_docs";
  category: string;
  business_id?: string;       // EPC docs — admins may pass another business
  stakeholder_id?: string;    // EPC stakeholder docs
  application_id?: string;    // loan app docs
  uploaded_by?: "epc" | "admin";
  gps?: { lat: number; lng: number; captured_at: string } | null;
};

export type UploadOk = {
  ok: true;
  id: string;
  storage_path: string;
  mime_type: string;
  original_size_bytes: number;
  stored_size_bytes: number;
};

export type UploadErr = { ok: false; error: string };

export async function uploadDocument(
  file: File,
  meta: UploadMeta,
): Promise<UploadOk | UploadErr> {
  const form = new FormData();
  form.append("file", file);
  form.append("table", meta.table);
  form.append("category", meta.category);
  if (meta.business_id) form.append("business_id", meta.business_id);
  if (meta.stakeholder_id) form.append("stakeholder_id", meta.stakeholder_id);
  if (meta.application_id) form.append("application_id", meta.application_id);
  if (meta.uploaded_by) form.append("uploaded_by", meta.uploaded_by);
  if (meta.gps) form.append("gps", JSON.stringify(meta.gps));

  const res = await fetch("/api/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken() ?? ""}` },
    body: form,
  });
  return res.json();
}

// New signature: takes a doc id, not a storage path. The server looks up the
// path via RLS-protected query, then mints a signed GCS URL.
export async function getDocumentUrl(docId: string): Promise<string | null> {
  const res = await fetch(`/api/document/${docId}`, {
    headers: { Authorization: `Bearer ${getToken() ?? ""}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { ok: boolean; url?: string };
  return data.ok && data.url ? data.url : null;
}

export async function deleteDocument(docId: string): Promise<boolean> {
  const res = await fetch(`/api/document/${docId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${getToken() ?? ""}` },
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { ok: boolean };
  return data.ok === true;
}
