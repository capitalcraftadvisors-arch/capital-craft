"use client";

// Claude connector (MCP, migration 0095) — the owner's connector links (Pri portal, 0096).
// Create a link (shown ONCE: it carries a secret key), copy it into Claude, and
// revoke it any time. Links expire after 90 days. Read-only portal data.

import { useEffect, useState } from "react";
import { supabase, FUNCTIONS_URL } from "@/lib/supabase";
import { getToken } from "@/lib/auth";
import { fmtDate } from "@/lib/dates";

type Link = { id: string; created_at: string; expires_at: string; revoked_at: string | null };

export default function ClaudeConnectorCard() {
  const [links, setLinks] = useState<Link[] | null>(null);
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase().from("mcp_tokens").select("id, created_at, expires_at, revoked_at").order("created_at", { ascending: false });
    setLinks((data ?? []) as Link[]);
  }
  useEffect(() => { void load(); }, []);

  async function create() {
    if (busy) return;
    setBusy(true); setError(null); setCopied(false);
    try {
      const res = await fetch(`${FUNCTIONS_URL}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ action: "mcp_create" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok || !d.key) { setError(d?.error || `Couldn't create the link (HTTP ${res.status}).`); return; }
      setNewUrl(`${window.location.origin}/api/mcp/${d.key}`);
      await load();
    } finally { setBusy(false); }
  }

  async function revoke(id: string) {
    if (!window.confirm("Revoke this connector link? Claude will lose access through it.")) return;
    const { error: e } = await supabase().from("mcp_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (e) { setError("Couldn't revoke — " + e.message); return; }
    await load();
  }

  async function copy() {
    if (!newUrl) return;
    try { await navigator.clipboard.writeText(newUrl); setCopied(true); } catch { setError("Couldn't copy — select the link and copy it."); }
  }

  const state = (l: Link) => (l.revoked_at ? "Revoked" : new Date(l.expires_at).getTime() < Date.now() ? "Expired" : "Active");
  const th = "px-4 py-2.5 font-semibold text-left whitespace-nowrap";
  return (
    <section className="bg-white border border-line rounded-xl mt-6">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold text-text">Claude connector</h2>
        <button type="button" onClick={() => void create()} disabled={busy}
          className="text-[12px] font-semibold px-3 py-1.5 rounded bg-[#178a5c] text-white hover:bg-[#12734c] disabled:opacity-60">
          {busy ? "Creating…" : "Create connector link"}
        </button>
      </div>
      {newUrl && (
        <div className="px-4 py-3 border-b border-line flex items-center gap-2">
          <code className="flex-1 min-w-0 truncate select-all rounded-[8px] border border-[#cdeadd] bg-[#f0faf5] px-3 py-2 text-[12px] font-mono text-[#0f3d2e]" title={newUrl}>{newUrl}</code>
          <button type="button" onClick={() => void copy()}
            className="text-[12px] font-semibold px-3 py-2 rounded-[8px] border border-[#cdeadd] bg-white text-[#178a5c] hover:bg-[#f0faf5]">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {error && <p className="mx-4 mt-3 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-[8px] px-3 py-2">{error}</p>}
      {links && links.length > 0 && (
        <table className="w-full text-[13px]">
          <thead><tr className="text-text-muted"><th className={th}>Created</th><th className={th}>Expires</th><th className={th}>Status</th><th className={th} /></tr></thead>
          <tbody>
            {links.map((l) => (
              <tr key={l.id} className="border-t border-line">
                <td className="px-4 py-2.5 text-text">{fmtDate(l.created_at)}</td>
                <td className="px-4 py-2.5 text-text">{fmtDate(l.expires_at)}</td>
                <td className={"px-4 py-2.5 font-semibold " + (state(l) === "Active" ? "text-[#178a5c]" : "text-text-muted")}>{state(l)}</td>
                <td className="px-4 py-2.5 text-right">
                  {state(l) === "Active" && (
                    <button type="button" onClick={() => void revoke(l.id)}
                      className="text-[12px] font-semibold px-3 py-1.5 rounded border border-red-200 text-red-600 hover:bg-red-50">Revoke</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
