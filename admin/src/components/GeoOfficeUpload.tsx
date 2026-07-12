"use client";

// GeoOfficeUpload — Step 5 office-verification photos. Enforces geo-tagging.
//
// Two entry points per slot:
//
//   1. "Take photo" → opens a LIVE in-browser camera (getUserMedia). On
//      mobile this is the rear camera; on desktop the webcam. Capture grabs
//      a still frame, then reads LIVE GPS via navigator.geolocation. A cold
//      GPS fix on mobile can take >10s, so we allow a generous timeout and
//      fall back to a coarse/network fix before giving up.
//
//   2. "Upload file" → plain file picker. The uploaded image MUST carry
//      EXIF GPS (a location-tagged photo). We read GPS from the WHOLE file
//      (no chunked windowing — that can miss the GPS block on some phone
//      photos) BEFORE the server ever compresses it.
//
// Both paths capture the coordinates into the doc row's metadata.gps and
// then show the latitude/longitude + a resolved address, so the EPC can see
// exactly where the photo was taken.
//
// Uploads go through the same lib/storage primitives FileUpload uses, so
// row shape, thumbnails, RLS, and admin views are identical. NOTE: the
// server (/api/upload) re-encodes images with sharp, which STRIPS EXIF from
// the stored file — that's why GPS is read client-side and persisted into
// metadata.gps, never re-derived from the stored image.

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

type Gps = { lat: number; lng: number; captured_at: string };

type DocRow = {
  id: string;
  storage_path: string;
  mime_type: string | null;
  file_name: string | null;
  metadata?: { gps?: Gps } | null;
};

// Reads EXIF GPS from the WHOLE file. Passing a fully-loaded ArrayBuffer
// (instead of the File) means exifr parses the entire image rather than a
// chunked window, so the GPS IFD is always in range — the chunked reader
// could miss it on some phone photos and report a genuinely-tagged image as
// having no location. Throws on a real parse error (so the caller can tell
// "couldn't read the photo" apart from "photo has no GPS"); returns null
// only when the image simply carries no GPS.
async function readExifGps(file: File): Promise<Gps | null> {
  const buf = await file.arrayBuffer();
  const out = await exifrGps(buf);
  if (out && typeof out.latitude === "number" && typeof out.longitude === "number") {
    return { lat: out.latitude, lng: out.longitude, captured_at: new Date().toISOString() };
  }
  return null;
}

// Live GPS for the camera path. A first-fix on mobile can take a while, so we
// give the high-accuracy attempt a long timeout and fall back to a coarse
// network fix before giving up.
function requestLiveGeo(): Promise<Gps | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    const ok = (p: GeolocationPosition) =>
      resolve({ lat: p.coords.latitude, lng: p.coords.longitude, captured_at: new Date().toISOString() });
    navigator.geolocation.getCurrentPosition(
      ok,
      () =>
        navigator.geolocation.getCurrentPosition(ok, () => resolve(null), {
          timeout: 12000,
          enableHighAccuracy: false,
          maximumAge: 60000,
        }),
      { timeout: 20000, enableHighAccuracy: true, maximumAge: 0 },
    );
  });
}

export default function GeoOfficeUpload({ businessId, category, label }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [doc, setDoc] = useState<DocRow | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [gps, setGps] = useState<Gps | null>(null);
  const [address, setAddress] = useState<string | null>(null);
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
        .select("id, storage_path, mime_type, file_name, metadata")
        .eq("business_id", businessId)
        .eq("category", category)
        .limit(1);
      const row = (data ?? [])[0] as DocRow | undefined;
      if (!row) return;
      setDoc(row);
      const g = row.metadata?.gps ?? null;
      if (g && typeof g.lat === "number" && typeof g.lng === "number") {
        setGps(g);
        void resolveAddress(g);
      }
      if ((row.mime_type || "").startsWith("image/")) {
        const u = await getDocumentUrl(row.id);
        if (u) setThumb(u);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Reverse-geocode the coordinates to a readable address. Best-effort — a
  // failure just leaves the lat/lng showing without a street address.
  async function resolveAddress(g: Gps) {
    try {
      const res = await fetch(`/api/reverse-geocode?lat=${g.lat}&lng=${g.lng}`);
      const d = await res.json().catch(() => ({}));
      if (d?.ok && d.address) setAddress(d.address);
    } catch {
      /* ignore */
    }
  }

  async function persist(file: File, coords: Gps) {
    setUploading(true);
    setStatus("Uploading…");
    const r = await uploadDocument(file, { table: "epc_documents", category, business_id: businessId, gps: coords });
    setUploading(false);
    setStatus(null);
    if (!r.ok) {
      setError(r.error || "Upload failed. Please try again.");
      return;
    }
    const row: DocRow = { id: r.id, storage_path: r.storage_path, mime_type: r.mime_type, file_name: file.name };
    setDoc(row);
    setGps(coords);
    setAddress(null);
    void resolveAddress(coords);
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

    setCamError("Getting your location… please allow location access.");
    const coords = await requestLiveGeo();
    if (!coords) {
      setCamBusy(false);
      setCamError("We couldn't get your location. Please allow location access and try again.");
      return;
    }
    const file = new File([blob], `office-${category}-${Date.now()}.jpg`, { type: "image/jpeg" });
    stopStream();
    setCamOpen(false);
    setCamBusy(false);
    await persist(file, coords);
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
    let coords: Gps | null = null;
    try {
      coords = await readExifGps(file);
    } catch (err) {
      // A genuine parse failure (corrupt/unsupported EXIF) — distinct from a
      // photo that simply has no GPS. Surface the real reason to the console.
      console.warn("[GeoOfficeUpload] EXIF read failed:", err);
      setStatus(null);
      setError("Couldn’t read this photo’s data. Try a different photo, or use “Take photo”.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (!coords) {
      setStatus(null);
      setError("This photo has no location data. Please upload a photo that was taken with location on, or use “Take photo”.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    await persist(file, coords);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function remove() {
    if (!doc) return;
    const ok = await deleteDocument(doc.id);
    if (!ok) { setError("Could not delete this file."); return; }
    setDoc(null);
    setThumb(null);
    setGps(null);
    setAddress(null);
  }

  return (
    <div>
      <p className="text-[13px] font-medium text-text-mid mb-2">{label}</p>

      {doc ? (
        <>
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
          {gps && (
            <div className="mb-2 px-3 py-2 rounded-input bg-blue-50 border border-blue/15">
              <p className="text-[12px] text-text-mid flex items-center gap-1.5">
                <span aria-hidden>📍</span>
                <span className="font-medium">{gps.lat.toFixed(6)}, {gps.lng.toFixed(6)}</span>
              </p>
              {address && <p className="text-[12px] text-text-muted mt-0.5">{address}</p>}
            </div>
          )}
        </>
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
            <p className={"mt-3 text-[13px] " + (camError.startsWith("Getting your location") ? "text-white/80" : "text-red-300")}>
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
