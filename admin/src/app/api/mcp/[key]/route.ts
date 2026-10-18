// /api/mcp/<connector key> — the portal's MCP server (Claude connector).
//
// Model Context Protocol over Streamable HTTP, JSON responses (no SSE needed):
// initialize, ping, tools/list, tools/call. The connector key in the URL is
// opaque (migration 0095); it is exchanged at the `auth` edge function for a
// 5-minute SELECT-only JWT (role mcp_reader) acting as its owner, cached per
// instance until it nears expiry. The tools (lib/mcp-tools) are read-only.

import { NextRequest, NextResponse } from "next/server";
import { FUNCTIONS_URL } from "@/lib/supabase";
import { insuranceClient as callerClient } from "@/lib/insurance-server";
import { MCP_TOOLS } from "@/lib/mcp-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS =
  "Capital Craft portal (solar-loan and insurance distribution, India), read-only. Use loan_summary for counts / amounts over a period, " +
  "search_* to list records, get_loan / get_epc for one record. Amounts are rupees; dates DD/MM/YYYY; FY = April–March.";

type RpcMsg = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, any> };

// key → { jwt, expiresAt } (per server instance)
const passCache = new Map<string, { jwt: string; exp: number }>();
async function passFor(key: string): Promise<string | null> {
  const hit = passCache.get(key);
  if (hit && hit.exp - Date.now() > 30_000) return hit.jwt;
  const res = await fetch(`${FUNCTIONS_URL}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "mcp_exchange", key }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d?.ok || !d.token) { passCache.delete(key); return null; }
  passCache.set(key, { jwt: d.token, exp: Date.now() + (Number(d.expires_in) || 300) * 1000 });
  return d.token as string;
}

const rpcResult = (id: RpcMsg["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: RpcMsg["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(msg: RpcMsg, jwt: string): Promise<object | null> {
  const id = msg.id;
  if (id === undefined || id === null) return null; // notification (e.g. notifications/initialized)
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "capital-craft-portal", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, {
        tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: true } })),
      });
    case "tools/call": {
      const tool = MCP_TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(msg.params?.name)}`);
      try {
        const out = await tool.run(callerClient(jwt), (msg.params?.arguments ?? {}) as Record<string, unknown>);
        return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(out) }] });
      } catch (e) {
        return rpcResult(id, { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${String(msg.method)}`);
  }
}

export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  const jwt = await passFor(params.key);
  if (!jwt) return NextResponse.json(rpcError(null, -32001, "Invalid or revoked connector link."), { status: 401 });

  const batch = Array.isArray(body);
  const replies = (await Promise.all((batch ? body : [body]).map((m: RpcMsg) => handle(m, jwt)))).filter(Boolean);
  if (!replies.length) return new NextResponse(null, { status: 202 }); // only notifications
  return NextResponse.json(batch ? replies : replies[0]);
}

// No server-initiated stream; sessions aren't used.
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
