// Server-only helpers for the admin ZIP routes (loan pack, tranche pack,
// insurance pack): the shared load, the name a stored file gets inside the ZIP,
// and the reply that streams the archive (archiver → Node Readable → Web
// ReadableStream).

import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import type { Archiver } from "archiver";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The last segment of a storage path ("file" when it has none). */
export function baseName(path: string): string {
  return path.split("/").pop() || "file";
}

/** The loan ZIP routes' load, in parallel: the whole loan row (+ the EPC's names)
 *  and its user_application_docs rows. */
export async function loadLoanAndDocs(supabase: SupabaseClient, appId: string) {
  const [{ data: loan, error }, { data: docs }] = await Promise.all([
    supabase.from("epc_applications")
      .select("*, epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)")
      .eq("id", appId)
      .maybeSingle(),
    supabase.from("user_application_docs")
      .select("id, category, storage_path, file_name")
      .eq("application_id", appId),
  ]);
  return { loan, error, docs };
}

/** Streams the archive back as the download `<name>.zip`, never cached. */
export function zipResponse(archive: Archiver, name: string): NextResponse {
  const webStream = Readable.toWeb(archive) as unknown as ReadableStream;
  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
