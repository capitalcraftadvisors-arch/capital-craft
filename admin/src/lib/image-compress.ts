// Server-only. The upload compression: images become JPEG, longest side at most
// 2000 px, quality 75; PDFs pass through unchanged. Used by /api/upload and the
// project site photos (/api/epc/project-photo).

import sharp from "sharp";

const MAX_DIMENSION = 2000;

export async function compressUpload(input: Buffer, mime: string): Promise<{ output: Buffer; mime: string }> {
  if (!mime.startsWith("image/")) return { output: input, mime };
  const output = await sharp(input)
    .rotate()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 75, mozjpeg: true })
    .toBuffer();
  return { output, mime: "image/jpeg" };
}
