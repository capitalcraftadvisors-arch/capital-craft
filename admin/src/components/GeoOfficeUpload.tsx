"use client";

// GeoOfficeUpload — Step 5 office-verification photos. Enforces geo-tagging.
//
// Two entry points per slot:
//
//   1. "Take photo" → opens a LIVE in-browser camera (getUserMedia). On
//      capture we grab the frame, read LIVE GPS, reverse-geocode it, and
//      BURN a location banner (title + address + lat/long + IST time)
//      directly onto the photo pixels — GPS Map Camera style — so the geo
//      info lives in the image itself and survives the server's compression
//      (which strips EXIF). A cold GPS fix on mobile can take >10s, so we
//      allow a generous timeout with a coarse fallback.
//
//   2. "Upload file" → plain file picker. The photo must prove its location
//      one of two ways: EXIF GPS (read from the full file before upload), OR
//      a visible GPS-stamp banner whose coordinates we OCR (GPS Map Camera
//      and similar apps burn "Lat …° Long …°" onto the image but usually
//      write no EXIF). No location either way → rejected.
//
// Uploads go through the same lib/storage primitives FileUpload uses, so row
// shape, thumbnails, RLS, and admin views are identical. Captured coordinates
// are persisted to the doc row's metadata.gps and shown as lat/long + a
// resolved address.

import { useEffect, useRef, useState } from "react";
import { gps as exifrGps } from "exifr";
import { supabase } from "@/lib/supabase";
import { uploadDocument, getDocumentUrl, deleteDocument } from "@/lib/storage";
import { getToken } from "@/lib/auth";
import { isAcceptedFileType } from "@/lib/validators";

// EPC office photos (epc_documents) or loan completion photos
// (user_application_docs) — the geo rules are identical, so one component
// serves both. Exactly ONE of businessId / applicationId is expected.
type Gps = { lat: number; lng: number; captured_at: string };

type Props = {
  category: string;
  label: string;
  businessId?: string;
  applicationId?: string;
  uploadedBy?: "epc" | "admin";
  hint?: string;
  // Custom-upload override: when provided, the component skips the built-in
  // epc_documents / user_application_docs write and calls this instead (used
  // by the insurance flow, whose photo lives as a column path, not a doc
  // row). The geo capture — EXIF read, live camera, Vision stamp fallback,
  // lat/long + address — is identical either way.
  uploadFn?: (file: File, gps: Gps) => Promise<{ ok: boolean; error?: string }>;
  // Seed an already-uploaded photo when using uploadFn (no DB row to read).
  initialGps?: Gps | null;
  onUploaded?: (gps: Gps) => void;
};

type DocRow = {
  id: string;
  storage_path: string;
  mime_type: string | null;
  file_name: string | null;
  metadata?: { gps?: Gps } | null;
};

// Reads EXIF GPS from the WHOLE file. Passing a fully-loaded ArrayBuffer
// (instead of the File) means exifr parses the entire image rather than a
// chunked window, so the GPS IFD is always in range. Throws on a real parse
// error (caller falls back to OCR); returns null when the image carries no
// EXIF GPS.
async function readExifGps(file: File): Promise<Gps | null> {
  const buf = await file.arrayBuffer();
  const out = await exifrGps(buf);
  if (out && typeof out.latitude === "number" && typeof out.longitude === "number") {
    return { lat: out.latitude, lng: out.longitude, captured_at: new Date().toISOString() };
  }
  return null;
}

// OCR fallback for the upload path: pulls coordinates out of a burned-in
// GPS-stamp banner via the Vision route. Returns null when none is found.
async function readStampGps(file: File): Promise<Gps | null> {
  try {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/epc/extract-geo", {
      method: "POST",
      headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      body: fd,
    });
    const d = await res.json().catch(() => ({}));
    if (d?.ok && d.found && typeof d.lat === "number" && typeof d.lng === "number") {
      return { lat: d.lat, lng: d.lng, captured_at: new Date().toISOString() };
    }
  } catch {
    /* ignore — treated as "no location" */
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

// Resolves a title + address for the on-photo stamp / display. Best-effort.
async function fetchGeoMeta(g: Gps): Promise<{ title: string; address: string }> {
  try {
    const res = await fetch(`/api/reverse-geocode?lat=${g.lat}&lng=${g.lng}`);
    const d = await res.json().catch(() => ({}));
    if (d?.ok) return { title: d.title || "", address: d.address || "" };
  } catch {
    /* ignore */
  }
  return { title: "", address: "" };
}

// "16/06/2026 01:07 PM India Standard Time"
function formatIST(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const ap = (get("dayPeriod") || "").toUpperCase();
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")} ${ap} India Standard Time`;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPin(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.fillStyle = "#e5342b";
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 1.35);
  ctx.arc(cx, cy, r, Math.PI * 0.78, Math.PI * 0.22, false);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();
}

// Burns the GPS-stamp banner onto a canvas that already holds the captured
// frame (bottom strip: pin thumbnail + title + address + coords + IST time).
function drawGeoStamp(
  canvas: HTMLCanvasElement,
  info: { title: string; address: string; lat: number; lng: number },
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  const fs = Math.max(18, Math.round(W * 0.026));
  const titleFs = Math.round(fs * 1.35);
  const lineH = Math.round(fs * 1.32);
  const pad = Math.round(fs * 0.9);

  ctx.textBaseline = "top";
  const mapSize = Math.round(fs * 5.4);
  const textX = pad + mapSize + pad;
  const textW = W - textX - pad;

  ctx.font = `${fs}px sans-serif`;
  const addrLines = wrapText(ctx, info.address || "", textW).slice(0, 2);
  const coordStr = `Lat ${info.lat.toFixed(6)}°  Long ${info.lng.toFixed(6)}°`;
  const dateStr = formatIST(new Date());

  const bannerH = pad * 2 + titleFs + Math.round(fs * 0.25) + (addrLines.length + 2) * lineH;
  const bannerY = H - bannerH;

  // Banner background.
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, bannerY, W, bannerH);

  // Map placeholder square + pin (keyless — a real map tile would need a
  // Static Maps API key).
  const mx = pad;
  const my = bannerY + pad;
  ctx.fillStyle = "#6f7f57";
  roundRect(ctx, mx, my, mapSize, mapSize, Math.round(fs * 0.4));
  ctx.fill();
  drawPin(ctx, mx + mapSize / 2, my + mapSize * 0.46, mapSize * 0.22);

  // Text.
  let ty = bannerY + pad;
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${titleFs}px sans-serif`;
  ctx.fillText(truncate(ctx, info.title || "Location captured", textW), textX, ty);
  ty += titleFs + Math.round(fs * 0.25);

  ctx.font = `${fs}px sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  for (const ln of addrLines) { ctx.fillText(ln, textX, ty); ty += lineH; }
  ctx.fillText(coordStr, textX, ty); ty += lineH;
  ctx.fillText(dateStr, textX, ty);
}

export default function GeoOfficeUpload({
  category, label, businessId, applicationId, uploadedBy, hint,
  uploadFn, initialGps, onUploaded,
}: Props) {
  // Which table this slot lives in. Loan completion photos hang off the
  // application; EPC office photos off the business.
  const isLoan = !!applicationId;
  const table  = isLoan ? "user_application_docs" : "epc_documents";
  const keyCol = isLoan ? "application_id" : "business_id";
  const keyVal = (isLoan ? applicationId : businessId) ?? "";

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
      // Custom-upload mode (insurance): no doc row to read. Seed from the
      // already-stored coordinates, if any.
      if (uploadFn) {
        if (initialGps && typeof initialGps.lat === "number" && typeof initialGps.lng === "number") {
          setDoc({ id: "", storage_path: "", mime_type: "image/jpeg", file_name: "Plant photo" });
          setGps(initialGps);
          void resolveAddress(initialGps);
        }
        return;
      }
      if (!keyVal) return;
      const { data } = await supabase()
        .from(table)
        .select("id, storage_path, mime_type, file_name, metadata")
        .eq(keyCol, keyVal)
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
  }, [table, keyCol, keyVal, category]);

  // Always stop the camera when the component unmounts.
  useEffect(() => () => stopStream(), []);

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  // Reverse-geocode the coordinates to a readable address for the 📍 display.
  async function resolveAddress(g: Gps) {
    const meta = await fetchGeoMeta(g);
    if (meta.address) setAddress(meta.address);
  }

  async function persist(file: File, coords: Gps) {
    setUploading(true);
    setStatus("Uploading…");

    // Custom-upload mode (insurance): hand the file + coords to the caller's
    // uploader, then show a local preview (no signed-URL round-trip).
    if (uploadFn) {
      const r = await uploadFn(file, coords);
      setUploading(false);
      setStatus(null);
      if (!r.ok) { setError(r.error || "Upload failed. Please try again."); return; }
      setDoc({ id: "", storage_path: "", mime_type: file.type, file_name: file.name });
      setGps(coords);
      setAddress(null);
      void resolveAddress(coords);
      if (file.type.startsWith("image/")) setThumb(URL.createObjectURL(file));
      onUploaded?.(coords);
      return;
    }

    const r = await uploadDocument(file, {
      table: table as "epc_documents" | "user_application_docs",
      category,
      ...(isLoan ? { application_id: applicationId } : { business_id: businessId }),
      ...(uploadedBy ? { uploaded_by: uploadedBy } : {}),
      gps: coords,
    });
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

    // Freeze the frame NOW so the photo is the moment of the click, not
    // whatever the camera sees after the GPS/geocode round-trip.
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) { setCamBusy(false); setCamError("Couldn't capture the photo. Try again."); return; }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    setCamError("Getting your location… please allow location access.");
    const coords = await requestLiveGeo();
    if (!coords) {
      setCamBusy(false);
      setCamError("We couldn't get your location. Please allow location access and try again.");
      return;
    }

    // Resolve the address, then burn the stamp onto the frozen frame.
    const meta = await fetchGeoMeta(coords);
    drawGeoStamp(canvas, { title: meta.title, address: meta.address, lat: coords.lat, lng: coords.lng });

    const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.92));
    if (!blob) { setCamBusy(false); setCamError("Couldn't capture the photo. Try again."); return; }

    const file = new File([blob], `office-${category}-${Date.now()}.jpg`, { type: "image/jpeg" });
    stopStream();
    setCamOpen(false);
    setCamBusy(false);
    await persist(file, coords);
  }

  // ── Upload path ("Upload file") — EXIF GPS or a burned-in GPS stamp ──
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
      // Real parse error — not "no GPS". Fall through to the OCR-stamp check.
      console.warn("[GeoOfficeUpload] EXIF read failed:", err);
    }
    // No EXIF GPS? Try to OCR a burned-in GPS-stamp banner (GPS Map Camera etc.).
    if (!coords) {
      setStatus("Reading location stamp…");
      coords = await readStampGps(file);
    }
    if (!coords) {
      setStatus(null);
      setError(
        "No location found in this photo. Upload a photo taken with location on, " +
          "or a GPS-camera photo with the location printed on it, or use “Take photo”.",
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    await persist(file, coords);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function remove() {
    if (!doc) return;
    // Custom-upload mode: just clear locally; the next upload overwrites the
    // stored path (there's no doc row to delete).
    if (uploadFn) {
      setDoc(null); setThumb(null); setGps(null); setAddress(null);
      return;
    }
    const ok = await deleteDocument(doc.id);
    if (!ok) { setError("Could not delete this file."); return; }
    setDoc(null);
    setThumb(null);
    setGps(null);
    setAddress(null);
  }

  return (
    <div>
      <p className="text-[13px] font-medium text-text-mid mb-0.5">{label}</p>
      {hint && <p className="text-[11px] text-text-muted mb-2">{hint}</p>}
      {!hint && <div className="mb-2" />}

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
            <p className="text-[11px] text-text-muted mt-0.5">Location or GPS stamp</p>
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
