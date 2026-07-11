"use client";

// GeoOfficeUpload — Step 5 office-verification photos. Enforces geo-tagging.
//
// Two entry points per slot:
//
//   1. "Take photo" → opens a LIVE in-browser camera (getUserMedia). On
//      mobile this is the rear camera; on desktop the webcam. Capture grabs
//      a still frame, then reads LIVE GPS via navigator.geolocation. If
//      location can't be obtained → the capture is rejected with a clear
//      message. This works on desktop + mobile (unlike <input capture>,
//      which silently falls back to a file picker on desktop).
//
//   2. "Upload file" → plain file picker. The uploaded image MUST carry
//      EXIF GPS (a location-tagged photo). No live-geo fallback — the user
//      is uploading something taken earlier. No GPS → rejected.
//
// Uploads go through the same lib/storage primitives FileUpload uses, so
// row shape, thumbnails, RLS, and admin views are identical.

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
      return { lat: out.latitude, lng: out.longitude, captured_at: new Date().toISOString() };
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
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, captured_at: new Date().toISOString() }),
      () => resolve(null),
      { timeout: 8000, enableHighAccuracy: true },
    );
  });
}

export default function GeoOfficeUpload({ businessId, category, label }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [doc, setDoc] = useState<DocRow | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [camOpen, setCamOpen] = useState(false);
  const [camBusy, setCamBusy] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);

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

  // Always stop the camera when the component unmounts.
  useEffect(() => () => stopStream(), []);

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function persist(file: File, gps: Gps) {
    setUploading(true);
    setStatus("Uploading…");
    const r = await uploadDocument(file, { table: "epc_documents", category, business_id: businessId, gps });
    setUploading(false);
    setStatus(null);
    if (!r.ok) {
      setError(r.error || "Upload failed. Please try again.");
      return;
    }
    const row: DocRow = { id: r.id, storage_path: r.storage_path, mime_type: r.mime_type, file_name: file.name };
    setDoc(row);
    if ((row.mime_type || "").startsWith("image/")) {
      const u = await getDocumentUrl(row.id);
      if (u) setThumb(u);
    }
  }

  // ── Live camera ("Take photo") ─────────────────────────────────────
  async function openCamera() {
    setError(null);
    setCamError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Live camera isn’t available here. Use "Upload file" with a location-tagged photo instead.');
      return;
    }
    setCamOpen(true);
    try {
      // Prefer the rear camera on phones; falls back to any camera on desktop.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch {
      stopStream();
      setCamOpen(false);
      setError('Couldn’t open the camera. Please allow camera access, or use "Upload file".');
    }
  }

  function closeCamera() {
    stopStream();
    setCamOpen(false);
    setCamBusy(false);
    setCamError(null);
  }

  async function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setCamError("Camera still starting — try again in a moment.");
      return;
    }
    setCamBusy(true);
    setCamError(null);
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) { setCamBusy(false); setCamError("Couldn't capture the photo. Try again."); return; }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.9));
    if (!blob) { setCamBusy(false); setCamError("Couldn't capture the photo. Try again."); return; }

    setCamError("Getting location…");
    const gps = await requestLiveGeo();
    if (!gps) {
      setCamBusy(false);
      setCamError("We couldn't get your location. Please allow location access and try again.");
      return;
    }
    const file = new File([blob], `office-${category}-${Date.now()}.jpg`, { type: "image/jpeg" });
    stopStream();
    setCamOpen(false);
    setCamBusy(false);
    await persist(file, gps);
  }

  // ── Upload path ("Upload file") — EXIF GPS required ────────────────
  async function handleUploadFile(files: FileList | null) {
    setError(null);
    setStatus(null);
    const file = files?.[0];
    if (!file) return;
    if (!isAcceptedFileType(file.type)) {
      setError("Only JPG, PNG, WEBP, or PDF files are allowed.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setStatus("Reading location from photo…");
    const gps = await readExifGps(file);
    if (!gps) {
      setStatus(null);
      setError("This photo has no location data. Please upload a photo that was taken with location on, or use “Take photo”.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    await persist(file, gps);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function remove() {
    if (!doc) return;
    const ok = await deleteDocument(doc.id);
    if (!ok) { setError("Could not delete this file."); return; }
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
            <div className="w-10 h-10 bg-bg-tint rounded-md grid place-items-center text-blue text-xs font-bold">PDF</div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-text truncate">{doc.file_name || "Document"}</p>
            <p className="text-[11px] text-text-muted">Geo-tagged · Uploaded</p>
          </div>
          <button type="button" onClick={remove} className="text-[12px] text-text-muted hover:text-red-500 transition-colors">
            Remove
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={openCamera}
            disabled={uploading}
            className={[
              "block border-2 border-dashed border-line rounded-input bg-white",
              "px-3 py-4 text-center cursor-pointer hover:border-blue transition-colors disabled:opacity-60",
            ].join(" ")}
          >
            <p className="text-[13px] text-text-mid font-medium">Take photo</p>
            <p className="text-[11px] text-text-muted mt-0.5">Live camera + GPS</p>
          </button>
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
            <p className="text-[11px] text-text-muted mt-0.5">Must have location</p>
          </label>
        </div>
      )}

      {status && <p className="mt-1.5 text-[12px] text-text-muted">{status}</p>}
      {error && !status && <p className="mt-1.5 text-[12px] text-red-500">{error}</p>}

      {/* Live camera modal */}
      {camOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-4">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="max-w-full max-h-[68vh] rounded-lg bg-black"
          />
          {camError && (
            <p className={"mt-3 text-[13px] " + (camError === "Getting location…" ? "text-white/80" : "text-red-300")}>
              {camError}
            </p>
          )}
          <div className="flex gap-3 mt-4">
            <button
              type="button"
              onClick={closeCamera}
              disabled={camBusy}
              className="px-4 py-2 rounded-input text-[14px] font-semibold bg-white/10 text-white border border-white/30 hover:bg-white/20 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={capture}
              disabled={camBusy}
              className="px-5 py-2 rounded-input text-[14px] font-semibold bg-white text-[#0f3d2e] hover:bg-white/90 disabled:opacity-50"
            >
              {camBusy ? "Capturing…" : "Capture photo"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
