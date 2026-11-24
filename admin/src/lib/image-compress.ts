// Server-only. The upload compression: images become JPEG, longest side at most
// 2000 px, quality 75 (the insurance uploads ask for 80); PDFs pass through
// unchanged. Used by /api/upload, the project site photos (/api/epc/project-photo),
// the loan and insurance document routes.

import sharp from "sharp";

const MAX_DIMENSION = 2000;

export async function compressUpload(input: Buffer, mime: string, quality = 75): Promise<{ output: Buffer; mime: string }> {
  if (!mime.startsWith("image/")) return { output: input, mime };
  const output = await sharp(input)
    .rotate()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
  return { output, mime: "image/jpeg" };
}
