// GET /api/epc/project-zip?project=<id> — a project's whole document vault as one
// ZIP (Partner Portal v2, lib/project-docs): "1. Site photos", "2. Project
// documents" and — not for Site staff — "3. Loan documents". Read with the
// caller's token, so RLS decides what goes in. Streamed (archiver → Node Readable
// → Web ReadableStream, like /api/epc/[id]/download-zip); a missing file is
// skipped, never fails the ZIP. Saved as Project_<customer>_<date>.zip.

import { NextRequest } from "next/server";
import archiver from "archiver";
import { Readable } from "node:stream";
import { err, dbAs, requireLogin } from "@/lib/api";
import { UUID_RE } from "@/lib/validators";
import { downloadBuffer } from "@/lib/gcs";
import { fmtDateIST } from "@/lib/dates";
import { vaultEntries, vaultViewer, type VaultEntry, type VaultGroup } from "@/lib/project-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FOLDER: Record<VaultGroup, string> = {
  "Site photos": "1. Site photos",
  "Project documents": "2. Project documents",
  "Loan documents": "3. Loan documents",
};

const segment = (s: string) => s.replace(/[<>:"|?*\\/\x00-\x1F]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 100) || "file";
function extOf(e: VaultEntry): string {
  const m = (e.mime || "").toLowerCase();
  if (m.includes("pdf")) return ".pdf";
  if (m.includes("jpeg") || m.includes("jpg")) return ".jpg";
  if (m.includes("png")) return ".png";
  if (m.includes("webp")) return ".webp";
  return (e.path.split("/").pop() || "").match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? "";
}
/** "2. Project documents/Agreement · deed.pdf" — the name's own extension gives way to the stored file's. */
const zipName = (e: VaultEntry) => `${FOLDER[e.group]}/${segment(e.name.replace(/\.[a-z0-9]{2,5}$/i, ""))}${extOf(e)}`;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireLogin(req);
    if (auth instanceof Response) return auth;
    const { token, claims } = auth;
    const id = req.nextUrl.searchParams.get("project") || "";
    if (!UUID_RE.test(id)) return err("not_found", 404);
    const v = await vaultEntries(dbAs(token), id, vaultViewer(claims));
    if (!v) return err("not_found", 404);

    const customer = v.customer.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "project";
    const filename = `Project_${customer}_${fmtDateIST(new Date()).replace(/\//g, "-")}.zip`;

    const archive = archiver("zip", { zlib: { level: 3 } });
    archive.on("warning", (e) => console.warn("[project-zip] archive warning:", e));
    archive.on("error", (e) => console.error("[project-zip] archive error:", e));

    void (async () => {
      try {
        const used = new Set<string>();
        for (const e of v.entries) {
          let name = zipName(e);
          for (let n = 2; used.has(name); n++) name = zipName(e).replace(/(\.[a-z0-9]+)?$/i, ` (${n})$1`);
          try {
            archive.append(await downloadBuffer(e.path), { name });
            used.add(name);
          } catch (x) {
            console.warn(`[project-zip] skipping missing object ${e.path}:`, x instanceof Error ? x.message : x);
          }
        }
        await archive.finalize();
      } catch (x) {
        console.error("[project-zip] build error:", x);
        archive.abort();
      }
    })();

    return new Response(Readable.toWeb(archive) as unknown as ReadableStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[project-zip] error:", msg);
    return err("Couldn't make the ZIP.", 500);
  }
}
