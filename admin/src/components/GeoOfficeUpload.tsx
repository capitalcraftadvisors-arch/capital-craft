"use client";

// GeoOfficeUpload — Step 5 only. Enforces the geo-tag requirement for office
// verification photos. Two entry buttons per slot:
//
//   1. "Take photo" → <input capture="environment"> (device camera).
//      On file select: try EXIF GPS via exifr; if missing, fall back to
//      navigator.geolocation.getCurrentPosition() in the same user gesture.
//      If neither yields coordinates → reject the upload.
//
//   2. "Upload file" → plain file picker.
//      On file select: parse EXIF GPS via exifr. EXIF-only, no live-geo
//      fallback (user is uploading something they took earlier). If EXIF
//      GPS is absent → reject with a clear message.
//
// The uploaded document is stored via the same lib/storage primitives that
// FileUpload uses (uploadDocument / getDocumentUrl / deleteDocument), so
// row shape, thumbnails, RLS, and admin views are identical.
//
// Bundle: exifr's "mini" build is used to keep the added weight ~10 KB
// gzipped. `.gps()` is the only symbol we need.

import { useEffect, useRef, useState } from "react";
import { gps as exifrGps } from "exifr";
import { supabase } from "@/lib/supabase";
import { uploadDocument, getDocumentUrl, deleteDocument } from "@/lib/storage";
import { isAcceptedFileType } from "@/lib/validators";

type Category = "office_exterior" | "office_interior" | "office_selfie";

type Props = {
  businessId: string;
  category: Category;
  label: string;
};

type DocRow = {
  id: string;
  storage_path: string;
  mime_type: string | null;
  file_name: string | null;
};

type Gps = { lat: number; lng: number; captured_at: string };

// exifr.gps() resolves to { latitude, longitude } when GPS is present,
// or undefined when it isn't. Guard on the numeric types anyway.
async function readExifGps(file: File): Promise<Gps | null> {
  try {
    const out = await exifrGps(file);
    if (out && typeof out.latitude === "number" && typeof out.longitude === "number") {
      return {
        lat: out.latitude,
        lng: out.longitude,
        captured_at: new Date().toISOString(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function requestLiveGeo(): Promise<Gps | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          captured_at: new Date().toISOString(),
        }),
      () => resolve(null),
      { timeout: 8000, enableHighAccuracy: true },
    );
  });
}

export default function GeoOfficeUpload({ businessId, category, label }: Props) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [doc, setDoc] = useState<DocRow | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase()
        .from("epc_documents")
        .select("id, storage_path, mime_type, file_name")
        .eq("business_id", businessId)
        .eq("category", category)
        .limit(1);
      const row = (data ?? [])[0] as DocRow | undefined;
      if (!row) return;
      setDoc(row);
      if ((row.mime_type || "").startsWith("image/")) {
        const u = await getDocumentUrl(row.id);
        if (u) setThumb(u);
      }
    })();
  }, [businessId, category]);

  async function persist(file: File, gps: Gps) {
    setUploading(true);
    setStatus("Uploading…");
    const r = await uploadDocument(file, {
      table: "epc_documents",
      category,
      business_id: businessId,
      gps,
    });
    setUploading(false);
    setStatus(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const row: DocRow = {
      id: r.id,
      storage_path: r.storage_path,
      mime_type: r.mime_type,
      file_name: file.name,
    };
    setDoc(row);
    if ((row.mime_type || "").startsWith("image/")) {
      const u = await getDocumentUrl(row.id);
      if (u) setThumb(u);
    }
  }

  async function handleCameraFile(files: FileList | null) {
    setError(null);
    setStatus(null);
    const file = files?.[0];
    if (!file) return;
    if (!isAcceptedFileType(file.type)) {
      setError("Only JPG, PNG, WEBP, or PDF files are allowed.");
      return;
    }
    setStatus("Getting location…");
    // Camera path: EXIF first, live-geo fallback.
    let gps = await readExifGps(file);
    if (!gps) gps = await requestLiveGeo();
    if (!gps) {
      setStatus(null);
      setError("We couldn't get your location. Please allow location access and try again.");
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      return;
    }
    await persist(file, gps);
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }

  async function handleUploadFile(files: FileList | null) {
    setError(null);
    setStatus(null);
    const file = files?.[0];
    if (!file) return;
    if (!isAcceptedFileType(file.type)) {
      setError("Only JPG, PNG, WEBP, or PDF files are allowed.");
      return;
    }
    setStatus("Reading location from photo…");
    const gps = await readExifGps(file);
    if (!gps) {
      setStatus(null);
      setError(
        "This photo has no location data. Please take the photo using your camera, or upload a location-tagged image.",
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    await persist(file, gps);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function remove() {
    if (!doc) return;
    const ok = await deleteDocument(doc.id);
    if (!ok) {
      setError("Could not delete this file.");
      return;
    }
    setDoc(null);
    setThumb(null);
  }

  return (
    <div>
      <p className="text-[13px] font-medium text-text-mid mb-2">{label}</p>

      {doc ? (
        <div className="flex items-center gap-3 bg-white border border-line rounded-input px-3 py-2 mb-2">
          {thumb ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={thumb} alt="" className="w-10 h-10 object-cover rounded-md" />
          ) : (
            <div className="w-10 h-10 bg-bg-tint rounded-md grid place-items-center text-blue text-xs font-bold">
              PDF
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-text truncate">{doc.file_name || "Document"}</p>
            <p className="text-[11px] text-text-muted">Geo-tagged · Uploaded</p>
          </div>
          <button
            type="button"
            onClick={remove}
            className="text-[12px] text-text-muted hover:text-red-500 transition-colors"
          >
            Remove
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <label
            className={[
              "block border-2 border-dashed border-line rounded-input bg-white",
              "px-3 py-4 text-center cursor-pointer hover:border-blue transition-colors",
            ].join(" ")}
          >
            <input
              ref={cameraInputRef}
              type="file"
              className="hidden"
              accept="image/*"
              capture="environment"
              onChange={(e) => handleCameraFile(e.target.files)}
              disabled={uploading}
            />
            <p className="text-[13px] text-text-mid font-medium">Take photo</p>
            <p className="text-[11px] text-text-muted mt-0.5">Uses live GPS</p>
          </label>
          <label
            className={[
              "block border-2 border-dashed border-line rounded-input bg-white",
              "px-3 py-4 text-center cursor-pointer hover:border-blue transition-colors",
            ].join(" ")}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*,application/pdf"
              onChange={(e) => handleUploadFile(e.target.files)}
              disabled={uploading}
            />
            <p className="text-[13px] text-text-mid font-medium">Upload file</p>
            <p className="text-[11px] text-text-muted mt-0.5">Must have GPS</p>
          </label>
        </div>
      )}

      {status && <p className="mt-1.5 text-[12px] text-text-muted">{status}</p>}
      {error && !status && <p className="mt-1.5 text-[12px] text-red-500">{error}</p>}
    </div>
  );
}
