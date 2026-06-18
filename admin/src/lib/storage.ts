import { supabase, FUNCTIONS_URL } from "./supabase";
import { getToken } from "./auth";

const BUCKET = "epc-docs";

// Uploads `file` to staging/{uuid}, then calls the store-document Edge Function
// which compresses images and moves the file to `finalPath`. Returns the final
// storage path + the original/stored sizes so the caller can insert a doc row.
export async function uploadDocument(file: File, finalPath: string): Promise<{
  ok: true;
  storage_path: string;
  mime_type: string;
  original_size_bytes: number;
  stored_size_bytes: number;
} | { ok: false; error: string }> {
  const id = crypto.randomUUID();
  const stagingPath = `staging/${id}`;

  const upload = await supabase().storage.from(BUCKET).upload(stagingPath, file, {
    contentType: file.type,
    upsert: false,
  });
  if (upload.error) return { ok: false, error: upload.error.message };

  const res = await fetch(`${FUNCTIONS_URL}/store-document`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken() ?? ""}`,
    },
    body: JSON.stringify({
      staging_path: stagingPath,
      final_path: finalPath,
      mime_type: file.type,
    }),
  });
  const data = await res.json();
  if (!data.ok) return { ok: false, error: data.error || "store_failed" };
  return {
    ok: true,
    storage_path: data.storage_path,
    mime_type: data.mime_type,
    original_size_bytes: data.original_size_bytes,
    stored_size_bytes: data.stored_size_bytes,
  };
}

export async function getSignedUrl(storagePath: string, expiresInSec = 3600): Promise<string | null> {
  const { data, error } = await supabase().storage.from(BUCKET).createSignedUrl(storagePath, expiresInSec);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function deleteStorageFile(storagePath: string): Promise<boolean> {
  const { error } = await supabase().storage.from(BUCKET).remove([storagePath]);
  return !error;
}
