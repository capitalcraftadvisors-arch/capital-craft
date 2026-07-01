// GCS client + signed URL helpers.
// Runs on Cloud Run with Application Default Credentials (ADC).
// No service-account key file: V4 signed URLs use IAM SignBlob via the
// `iam.serviceAccountTokenCreator` role the SA holds on itself.

import { Storage } from "@google-cloud/storage";

export const BUCKET = process.env.GCS_BUCKET || "capitalcraft-docs";

// Storage() with no args reads ADC from the Cloud Run metadata server.
const storage = new Storage();
const bucket = storage.bucket(BUCKET);

export async function uploadBuffer(
  path: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  const file = bucket.file(path);
  await file.save(buffer, {
    contentType,
    resumable: false,
    metadata: { contentType },
  });
}

// V4 signed URL for reading. When the auth credentials have no private key
// (Cloud Run / Cloud Functions / GCE), the @google-cloud/storage library
// transparently calls iam.serviceAccounts.signBlob to sign — that's why the
// SA needs serviceAccountTokenCreator on itself.
export async function getSignedReadUrl(
  path: string,
  expiresInSec = 3600,
): Promise<string> {
  const [url] = await bucket.file(path).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + expiresInSec * 1000,
  });
  return url;
}

export async function deleteObject(path: string): Promise<void> {
  try {
    await bucket.file(path).delete({ ignoreNotFound: true });
  } catch {
    // best effort
  }
}

// Downloads the object at `path` to an in-memory Buffer. Throws if the object
// is missing or unreadable — callers (e.g. /api/epc/[id]/download-zip) catch
// and skip so a single missing file doesn't fail the whole ZIP.
export async function downloadBuffer(path: string): Promise<Buffer> {
  const [buf] = await bucket.file(path).download();
  return buf;
}
