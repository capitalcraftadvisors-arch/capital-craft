// GET /api/admin/claude-questions — the owner's Excel of what the Capital Craft
// team asked Claude through the connector (mcp_calls, migration 0144): one row
// per question — who, when, what Claude looked up, what it couldn't answer, and
// each lookup's inputs. The caller's JWT, so RLS lets only the owner read it.

import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { err, dbAs, requireLogin } from "@/lib/api";
import { fmtDateTimeIST, todayIST, fmtDateIST } from "@/lib/dates";
import { errText } from "@/lib/errors";
import { sheetHeader } from "@/lib/excel-sheet";
import { groupCalls, MCP_CALL_COLS, type McpCall } from "@/lib/claude-questions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireLogin(req, { role: "main_admin" });
    if (auth instanceof Response) return auth;
    const db = dbAs(auth.token);
    const [{ data, error }, { data: team }] = await Promise.all([
      db.from("mcp_calls").select(MCP_CALL_COLS).order("created_at", { ascending: true }),
      db.rpc("team_accounts"),
    ]);
    if (error) return err(error.message, 500);
    const names = new Map<string, string>(((team ?? []) as { id: string; contact_name: string | null }[]).map((t) => [t.id, t.contact_name || "—"]));
    names.set(String(auth.claims.business_id), "You");

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Questions");
    sheetHeader(ws, `Claude questions — as on ${fmtDateIST(todayIST())}`, [
      { label: "When", width: 18 }, { label: "Person", width: 16 }, { label: "Question", width: 60 },
      { label: "Looked up", width: 26 }, { label: "Couldn't answer", width: 40 }, { label: "Errors", width: 8 },
      { label: "Lookups (inputs)", width: 70 },
    ]);
    for (const q of groupCalls((data ?? []) as McpCall[])) {
      const row = ws.addRow([
        fmtDateTimeIST(q.at), names.get(q.person_id) ?? "—", q.question, q.looked_up.join(", "),
        q.missing ?? "", q.failed || "", q.details.join("\n"),
      ]);
      row.alignment = { vertical: "top", wrapText: true };
    }
    return new NextResponse(Buffer.from(await wb.xlsx.writeBuffer()), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Claude questions ${fmtDateIST(todayIST()).replace(/\//g, "-")}.xlsx"`,
      },
    });
  } catch (e) {
    const msg = errText(e);
    console.error("[claude-questions] error:", msg);
    return err(msg, 500);
  }
}
