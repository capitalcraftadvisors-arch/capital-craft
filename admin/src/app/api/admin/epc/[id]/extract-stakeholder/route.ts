// POST /api/admin/epc/[id]/extract-stakeholder   multipart { file, kind }
//   kind: 'pan' | 'aadhaar_front' | 'aadhaar_back'
//
// Reads a stakeholder's just-uploaded PAN or Aadhaar with Gemini (Vision
// fallback) and returns the extracted fields — the client merges them into the
// stakeholder's epc_business.stakeholders JSONB (filling only empty fields).
// NO DB write here. Admin-only.
//
//   pan           → { name, father_name, dob }
//   aadhaar_front → { name, dob, gender, aadhaar_number }
//   aadhaar_back  → { care_of, address }

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getBearerToken, verifyJwt } from "@/lib/jwt";
import { geminiExtractPan } from "@/lib/doc-extractors";
import { geminiExtractAadhaar } from "@/lib/aadhaar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const KINDS = new Set(["pan", "aadhaar_front", "aadhaar_back"]);

function err(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

async function compress(file: File): Promise<{ buffer: Buffer; mime: string }> {
  const input = Buffer.from(await file.arrayBuffer());
  if (!file.type.startsWith("image/")) return { buffer: input, mime: file.type };
  const out = await sharp(input).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 75, mozjpeg: true }).toBuffer();
  return { buffer: out, mime: "image/jpeg" };
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) return err("unauthorized", 401);
    const claims = await verifyJwt(token);
    if (claims.business_type !== "admin") return err("admin_only", 403);

    const form = await req.formData();
    const file = form.get("file");
    const kind = String(form.get("kind") ?? "");
    if (!(file instanceof File)) return err("File is required.", 400);
    if (!ACCEPTED.has(file.type)) return err("File must be JPEG, PNG, WebP, or PDF.", 400);
    if (!KINDS.has(kind)) return err("Invalid kind.", 400);

    const { buffer, mime } = await compress(file);
    let fields: Record<string, string | null> = {};

    if (kind === "pan") {
      const g = await geminiExtractPan([{ buffer, mime }]);
      if (g) fields = { name: g.name, father_name: g.father_name, dob: g.dob };
    } else {
      // aadhaar (front or back) — Gemini reads whichever side is given.
      const g = await geminiExtractAadhaar([{ buffer, mime }]);
      if (g) {
        if (kind === "aadhaar_front") {
          fields = { name: g.name, dob: g.dob, gender: g.gender, aadhaar_number: g.aadhaar_number ?? g.aadhaar_masked };
        } else {
          fields = { care_of: g.care_of, address: g.address };
        }
      }
    }

    // Drop nulls so the client only fills what was actually read.
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) if (v && String(v).trim()) clean[k] = String(v).trim();

    return NextResponse.json({ ok: true, fields: clean });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[extract-stakeholder] error:", msg);
    return err(msg, 500);
  }
}
