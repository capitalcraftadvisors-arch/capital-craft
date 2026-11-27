"use client";

// Claude connector (MCP, migration 0095) — the owner's connector links (Pri portal, 0096):
// one per Capital Craft team login (0143), each reading as that person's login.
// Create a link (shown ONCE: it carries a secret key), copy it into that
// person's Claude, and revoke it any time. Links expire after 90 days.
// Read-only: portal data + the website's own code.
// "Questions asked" (closed until opened, then one read): what the team asked
// Claude through their links (mcp_calls, 0144), plus the full Excel download.

import { useEffect, useState } from "react";
import { supabase, FUNCTIONS_URL } from "@/lib/supabase";
import { authHeaders, getBusiness } from "@/lib/auth";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { askConfirm } from "@/lib/confirm";
import { saveDownload } from "@/lib/storage";
import { groupCalls, MCP_CALL_COLS, type AskedQuestion, type McpCall } from "@/lib/claude-questions";
import { I } from "@/components/view/ViewKit";

type Link = { id: string; business_id: string; created_at: string; expires_at: string; revoked_at: string | null };
type Person = { id: string; name: string };

export default function ClaudeConnectorCard() {
  const meId = getBusiness()?.id ?? "";
  const [links, setLinks] = useState<Link[] | null>(null);
  const [people, setPeople] = useState<Person[]>([{ id: meId, name: "You" }]);
  const [forId, setForId] = useState(meId);
  const [newUrl, setNewUrl] = useState<{ url: string; name: string } | null>(null);
  const [askedOpen, setAskedOpen] = useState(false);
  const [asked, setAsked] = useState<AskedQuestion[] | null>(null);
  const [who, setWho] = useState(""); // "" = everyone
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase().from("mcp_tokens").select("id, business_id, created_at, expires_at, revoked_at").order("created_at", { ascending: false });
    setLinks((data ?? []) as Link[]);
  }
  useEffect(() => {
    void load();
    // team_accounts() (0096) lists the Capital Craft team without the owner.
    void supabase().rpc("team_accounts").then(({ data }) => setPeople([{ id: meId, name: "You" },
      ...((data ?? []) as { id: string; contact_name: string | null }[]).map((t) => ({ id: t.id, name: t.contact_name || "—" }))]));
  }, [meId]);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "—";

  async function create() {
    if (busy) return;
    setBusy(true); setError(null); setCopied(false);
    try {
      const res = await fetch(`${FUNCTIONS_URL}/auth`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ action: "mcp_create", for: forId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok || !d.key) { setError(d?.error || `Couldn't create the link (HTTP ${res.status}).`); return; }
      setNewUrl({ url: `${window.location.origin}/api/mcp/${d.key}`, name: nameOf(forId) });
      await load();
    } finally { setBusy(false); }
  }

  async function revoke(id: string) {
    if (!(await askConfirm(`Revoke ${nameOf(links?.find((l) => l.id === id)?.business_id ?? "")}'s connector link? Claude will lose access through it.`, { danger: true }))) return;
    const { error: e } = await supabase().from("mcp_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (e) { setError("Couldn't revoke — " + e.message); return; }
    await load();
  }

  // The latest 500 calls, read once when the list is first opened.
  async function toggleAsked() {
    setAskedOpen((o) => !o);
    if (asked) return;
    const { data, error: e } = await supabase().from("mcp_calls").select(MCP_CALL_COLS).order("created_at", { ascending: false }).limit(500);
    if (e) { setError("Couldn't load the questions — " + e.message); return; }
    setAsked(groupCalls((data ?? []) as McpCall[]));
  }

  async function download() {
    setDownloading(true); setError(null);
    try {
      const res = await fetch("/api/admin/claude-questions", { headers: authHeaders() });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j?.error || `Couldn't build the Excel (HTTP ${res.status}).`); return; }
      await saveDownload(res, "Claude questions.xlsx");
    } finally { setDownloading(false); }
  }

  async function copy() {
    if (!newUrl) return;
    try { await navigator.clipboard.writeText(newUrl.url); setCopied(true); } catch { setError("Couldn't copy — select the link and copy it."); }
  }

  const shownAsked = (asked ?? []).filter((q) => !who || q.person_id === who);
  const state = (l: Link) => (l.revoked_at ? "Revoked" : new Date(l.expires_at).getTime() < Date.now() ? "Expired" : "Active");
  const th = "px-4 py-2.5 font-semibold text-left whitespace-nowrap";
  return (
    <section className="bg-white border border-line rounded-xl mt-6">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold text-text">Claude connector</h2>
        <div className="flex items-center gap-2">
          <select value={forId} onChange={(e) => setForId(e.target.value)} aria-label="Link for"
            className="text-[12px] font-semibold border border-line rounded px-2 py-1.5 bg-white text-text outline-none focus:border-cc-green">
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button type="button" onClick={() => void create()} disabled={busy}
            className="text-[12px] font-semibold px-3 py-1.5 rounded bg-cc-green text-white hover:bg-cc-green-hover disabled:opacity-60">
            {busy ? "Creating…" : "Create connector link"}
          </button>
        </div>
      </div>
      {newUrl && (
        <div className="px-4 py-3 border-b border-line flex items-center gap-2">
          <span className="text-[13px] font-semibold text-text whitespace-nowrap">{newUrl.name}</span>
          <code className="flex-1 min-w-0 truncate select-all rounded-[8px] border border-cc-line bg-cc-wash px-3 py-2 text-[12px] font-mono text-cc-ink" title={newUrl.url}>{newUrl.url}</code>
          <button type="button" onClick={() => void copy()}
            className="text-[12px] font-semibold px-3 py-2 rounded-[8px] border border-cc-line bg-white text-cc-green hover:bg-cc-wash">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {error && <p className="mx-4 mt-3 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-[8px] px-3 py-2">{error}</p>}
      {links && links.length > 0 && (
        <table className="w-full text-[13px]">
          <thead><tr className="text-text-muted"><th className={th}>Person</th><th className={th}>Created</th><th className={th}>Expires</th><th className={th}>Status</th><th className={th} /></tr></thead>
          <tbody>
            {links.map((l) => (
              <tr key={l.id} className="border-t border-line">
                <td className="px-4 py-2.5 font-semibold text-text">{nameOf(l.business_id)}</td>
                <td className="px-4 py-2.5 text-text">{fmtDate(l.created_at)}</td>
                <td className="px-4 py-2.5 text-text">{fmtDate(l.expires_at)}</td>
                <td className={"px-4 py-2.5 font-semibold " + (state(l) === "Active" ? "text-cc-green" : "text-text-muted")}>{state(l)}</td>
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
      <div className="border-t border-line">
        <div className="px-4 py-2.5 flex items-center gap-3">
          <button type="button" onClick={() => void toggleAsked()} aria-expanded={askedOpen}
            className="flex-1 min-w-0 flex items-center gap-2 text-left">
            <span aria-hidden="true" className={"shrink-0 text-text-muted transition-transform [&>svg]:w-4 [&>svg]:h-4 " + (askedOpen ? "rotate-90" : "")}>{I.chevRight}</span>
            <h3 className="text-[14px] font-bold text-text">Questions asked</h3>
          </button>
          {askedOpen && (
            <>
              <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Person"
                className="text-[12px] font-semibold border border-line rounded px-2 py-1.5 bg-white text-text outline-none focus:border-cc-green">
                <option value="">Everyone</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button type="button" onClick={() => void download()} disabled={downloading}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded border border-cc-line bg-white text-cc-green hover:bg-cc-wash disabled:opacity-60">
                {I.download} {downloading ? "Preparing…" : "Excel"}
              </button>
            </>
          )}
        </div>
        {askedOpen && (
          !asked ? <p className="px-4 pb-4 text-[13px] text-text-muted">Loading…</p>
          : !shownAsked.length ? <p className="px-4 pb-4 text-[13px] text-text-muted">No questions yet.</p>
          : (
            <div className="max-h-[480px] overflow-auto border-t border-line">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-white"><tr className="text-text-muted">
                  <th className={th}>When</th><th className={th}>Person</th><th className={th}>Question</th><th className={th}>Looked up</th><th className={th}>Couldn&apos;t answer</th>
                </tr></thead>
                <tbody>
                  {shownAsked.map((q, i) => (
                    <tr key={q.at + i} className="border-t border-line align-top">
                      <td className="px-4 py-2.5 text-text whitespace-nowrap">{fmtDateTime(q.at)}</td>
                      <td className="px-4 py-2.5 font-semibold text-text whitespace-nowrap">{nameOf(q.person_id)}</td>
                      <td className="px-4 py-2.5 text-text min-w-[260px]">{q.question}</td>
                      <td className="px-4 py-2.5 text-text-mid">{q.looked_up.join(", ") || "—"}</td>
                      <td className={"px-4 py-2.5 " + (q.missing ? "text-warn-ink font-semibold" : "text-text-muted")}>{q.missing || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </section>
  );
}
