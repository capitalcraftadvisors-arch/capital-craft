// Convert a .docx buffer to PDF using a headless LibreOffice (`soffice`).
// Available on prod (the Dockerfile installs libreoffice-writer); on localhost
// soffice usually isn't installed, so callers catch the error and fall back to
// serving the .docx. A unique UserInstallation profile per call avoids the
// single-profile lock when conversions overlap.

import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const BINS = ["soffice", "libreoffice"];

export function docxToPdf(docx: Buffer): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quote-"));
  const inPath = path.join(dir, "in.docx");
  const outPath = path.join(dir, "in.pdf");
  fs.writeFileSync(inPath, docx);
  const profile = "file://" + path.join(dir, "lo-profile").replace(/\\/g, "/");

  let ok = false;
  let lastErr = "";
  for (const bin of BINS) {
    const r = spawnSync(
      bin,
      ["--headless", `-env:UserInstallation=${profile}`, "--convert-to", "pdf:writer_pdf_Export", "--outdir", dir, inPath],
      { timeout: 90000 },
    );
    if (r.status === 0 && fs.existsSync(outPath)) { ok = true; break; }
    lastErr = (r.error?.message || "") + " " + (r.stderr ? r.stderr.toString().slice(0, 300) : "");
  }
  if (!ok) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    throw new Error("pdf_conversion_unavailable:" + lastErr.trim());
  }
  const pdf = fs.readFileSync(outPath);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return pdf;
}
