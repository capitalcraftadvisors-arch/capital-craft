"use client";

// Shared "Message to EPC" thread — admin ⇄ EPC, for both loan and insurance.
// Self-contained: loads its own messages + the parent's attention state under
// RLS (one query on mount — no polling), marks the thread seen, and posts every
// write through /api/messages. Rendered on the admin profile message window and
// on the EPC portal. Colours are neutral-blue so it sits fine on both the green
// admin theme and the navy EPC theme.

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getToken } from "@/lib/auth";
import {
  MSG_TEMPLATES, DOC_TAGS, docTagLabel,
  type Message, type MsgKind, type MsgAttachment, type MsgTemplate,
} from "@/lib/messages";

const CFG = {
  loan:      { msgTable: "loan_messages",      parentTable: "epc_applications",       fk: "application_id" },
  insurance: { msgTable: "insurance_messages", parentTable: "insurance_applications", fk: "insurance_application_id" },
} as const;

type Att = {
  attention_status: "open" | "resolved" | null;
  attention_raised_at: string | null;
  attention_resolved_at: string | null;
  attention_resolved_by: string | null;
  msg_epc_seen_at: string | null;
  msg_admin_seen_at: string | null;
};

export default function MessageThread({
  kind, id, role, onEdit, onChanged, sendKeys, requireKeys, onSent,
}: {
  kind: MsgKind; id: string; role: "admin" | "epc";
  onEdit?: (docTags: string[]) => void;   // EPC: open the edit flow (all tagged docs)
  onChanged?: () => void;                  // parent can refresh its lists
  sendKeys?: string[];   // admin loan: the ticked edit-table keys → doc_tags + grant
  requireKeys?: boolean; // admin loan: block Send until a row is ticked in the table
  onSent?: () => void;   // clear the table selection after a successful send
}) {
  const cfg = CFG[kind];
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [att, setAtt] = useState<Att>({
    attention_status: null, attention_raised_at: null, attention_resolved_at: null,
    attention_resolved_by: null, msg_epc_seen_at: null, msg_admin_seen_at: null,
  });
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [docTags, setDocTags] = useState<string[]>([]);
  // Which one-tap templates are currently in the message (toggle chips).
  const [usedTemplates, setUsedTemplates] = useState<Set<string>>(new Set());

  // Add a template's text on first tap, remove it (and its doc tag, if no other
  // used template needs it) on the second tap.
  function toggleTemplate(t: MsgTemplate) {
    if (usedTemplates.has(t.label)) {
      setBody((prev) => prev.split(t.body).join("").replace(/\s{2,}/g, " ").trim());
      setUsedTemplates((s) => { const n = new Set(s); n.delete(t.label); return n; });
      if (t.doc) {
        const stillUsed = MSG_TEMPLATES.some((x) => x.label !== t.label && x.doc === t.doc && usedTemplates.has(x.label));
        if (!stillUsed) setDocTags((s) => s.filter((x) => x !== t.doc));
      }
    } else {
      setBody((prev) => prev.trim() ? prev.trim() + " " + t.body : t.body);
      setUsedTemplates((s) => new Set(s).add(t.label));
      if (t.doc) setDocTags((s) => s.includes(t.doc!) ? s : [...s, t.doc!]);
    }
  }
  const [pending, setPending] = useState<MsgAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const seenRef = useRef(false);

  const authHdr = () => ({ Authorization: `Bearer ${getToken() ?? ""}` });

  async function load() {
    const [{ data: mrows }, { data: prow }] = await Promise.all([
      supabase().from(cfg.msgTable)
        .select("id, sender, author_id, author_name, body, attachments, doc_tags, edited_at, created_at")
        .eq(cfg.fk, id).order("created_at", { ascending: true }),
      supabase().from(cfg.parentTable)
        .select("attention_status, attention_raised_at, attention_resolved_at, attention_resolved_by, msg_epc_seen_at, msg_admin_seen_at")
        .eq("id", id).maybeSingle(),
    ]);
    setMsgs(((mrows ?? []) as unknown as Message[]).map((m) => ({ ...m, attachments: Array.isArray(m.attachments) ? m.attachments : [], doc_tags: Array.isArray(m.doc_tags) ? m.doc_tags : [] })));
    if (prow) setAtt(prow as unknown as Att);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // Mark the thread seen once (records the read receipt for the other side).
    if (!seenRef.current) {
      seenRef.current = true;
      void fetch("/api/messages", { method: "POST", headers: { ...authHdr(), "Content-Type": "application/json" }, body: JSON.stringify({ action: "seen", kind, id }) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id]);

  useEffect(() => {
    const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, loading]);

  // Auto-grow the composer so the whole message stays visible — no inner scroll.
  // (+ border delta because the box is border-box: height must exceed scrollHeight
  // by the borders or a 1–2px scrollbar remains.)
  useEffect(() => {
    const el = taRef.current; if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [body]);

  async function post(payload: Record<string, unknown>) {
    const res = await fetch("/api/messages", { method: "POST", headers: { ...authHdr(), "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, ...payload }) });
    return res.json().catch(() => ({}));
  }

  async function addFiles(list: FileList) {
    setUploading(true);
    for (const f of Array.from(list)) {
      const fd = new FormData(); fd.append("file", f); fd.append("kind", kind); fd.append("id", id);
      const res = await fetch("/api/messages/attach", { method: "POST", headers: authHdr(), body: fd });
      const j = await res.json().catch(() => ({}));
      if (j?.ok) setPending((p) => [...p, { path: j.path, name: j.name, mime: j.mime }]);
      else alert("Upload failed: " + (j?.error || ""));
    }
    setUploading(false);
  }

  async function view(a: MsgAttachment) {
    const res = await fetch("/api/messages/sign", { method: "POST", headers: { ...authHdr(), "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, path: a.path }) });
    const j = await res.json().catch(() => ({}));
    if (j?.ok && j.url) window.open(j.url as string, "_blank", "noopener");
    else alert("Couldn't open the attachment.");
  }

  async function send() {
    if (!body.trim() && pending.length === 0) return;
    if (requireKeys && (sendKeys?.length ?? 0) === 0) return;
    setBusy(true);
    // Admin loan: the ticked edit-table rows are the grant (doc_tags). Elsewhere
    // fall back to the inline chip tags.
    const tags = role === "admin" ? (sendKeys ?? docTags) : [];
    const j = await post({ action: "send", body: body.trim() || null, attachments: pending, doc_tags: tags });
    setBusy(false);
    if (!j?.ok) { alert("Couldn't send: " + (j?.error || "")); return; }
    setBody(""); setPending([]); setDocTags([]); setUsedTemplates(new Set());
    await load(); onChanged?.(); onSent?.();
  }

  async function saveEdit(m: Message) {
    setBusy(true);
    const j = await post({ action: "edit", message_id: m.id, body: editBody.trim() || null, attachments: m.attachments, doc_tags: m.doc_tags });
    setBusy(false);
    if (!j?.ok) { alert("Couldn't save: " + (j?.error || "")); return; }
    setEditId(null); setEditBody(""); await load();
  }

  async function remove(m: Message) {
    if (!confirm("Delete this message?")) return;
    const j = await post({ action: "delete", message_id: m.id });
    if (!j?.ok) { alert("Couldn't delete: " + (j?.error || "")); return; }
    await load();
  }

  async function setStatus(action: "resolve" | "reopen") {
    setBusy(true);
    const j = await post({ action });
    setBusy(false);
    if (!j?.ok) { alert("Couldn't update: " + (j?.error || "")); return; }
    await load(); onChanged?.();
  }

  const meSender = role === "admin" ? "admin" : "epc";
  const otherSeenAt = role === "admin" ? att.msg_epc_seen_at : att.msg_admin_seen_at;
  const myMsgs = msgs.filter((m) => m.sender === meSender);
  const lastMineId = myMsgs.length ? myMsgs[myMsgs.length - 1].id : null;
  // EVERY document tagged across the admin's messages drives the EPC "Edit
  // application" deep-link, so a file with several issues opens with all ticked.
  const editDocs = [...new Set(msgs.filter((m) => m.sender === "admin").flatMap((m) => m.doc_tags))];

  const A = "#1e3a8a";
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-white overflow-hidden" style={{ maxHeight: "78vh" }}>
      {/* Status bar */}
      <div className="shrink-0 px-4 py-2.5 border-b border-line bg-[#f7f9fe] flex items-center gap-2 flex-wrap">
        {att.attention_status === "open" ? (
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Open</span>
        ) : att.attention_status === "resolved" ? (
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#e6f6ee] text-[#178a5c]">Resolved{att.attention_resolved_by ? ` · by ${att.attention_resolved_by === "epc" ? "EPC" : "Capital Craft"}` : ""}</span>
        ) : (
          <span className="text-[11px] text-text-muted">No issue raised</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {role === "epc" && onEdit && att.attention_status === "open" && (
            <button onClick={() => onEdit(editDocs)} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg text-white" style={{ background: A }}>Edit application</button>
          )}
          {/* Resolve/Reopen is Capital Craft's control only. The EPC never marks
              it resolved — re-submitting their edited application auto-resolves it
              (that's the signal they've updated the file). */}
          {role === "admin" && (att.attention_status === "open" ? (
            <button onClick={() => void setStatus("resolve")} disabled={busy} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-[#178a5c] text-[#178a5c] hover:bg-[#f0faf5] disabled:opacity-50">Mark resolved</button>
          ) : att.attention_status === "resolved" ? (
            <button onClick={() => void setStatus("reopen")} disabled={busy} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-line text-text-mid hover:bg-bg-soft disabled:opacity-50">Reopen</button>
          ) : null)}
        </div>
      </div>

      {/* Thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3 min-h-[220px]">
        {loading ? (
          <p className="text-[13px] text-text-muted m-auto">Loading…</p>
        ) : msgs.length === 0 ? (
          <p className="text-[13px] text-text-muted m-auto text-center">No messages yet.{role === "admin" ? " Send the EPC a message about this profile." : ""}</p>
        ) : msgs.map((m) => {
          const mine = m.sender === meSender;
          return (
            <div key={m.id} className={mine ? "self-end max-w-[86%]" : "self-start max-w-[86%]"}>
              <div className="text-[11px] text-text-muted mb-1" style={{ textAlign: mine ? "right" : "left" }}>
                {m.author_name || (m.sender === "admin" ? "Capital Craft" : "EPC")} · {fmtWhen(m.created_at)}{m.edited_at ? " · edited" : ""}
                {m.doc_tags.map((t) => docTagLabel(t)).filter(Boolean).map((lbl, i) => (
                  <span key={i} className="font-semibold" style={{ color: A }}> · {lbl}</span>
                ))}
              </div>
              {editId === m.id ? (
                <div className="flex flex-col gap-1.5">
                  <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={2} className="border border-line rounded-xl px-3 py-2 text-[13px] outline-none focus:border-[#1e3a8a]" />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditId(null)} className="text-[12px] text-text-muted">Cancel</button>
                    <button onClick={() => void saveEdit(m)} disabled={busy} className="text-[12px] font-semibold text-white px-3 py-1 rounded-lg disabled:opacity-50" style={{ background: A }}>Save</button>
                  </div>
                </div>
              ) : (
                <div className={["rounded-2xl px-3.5 py-2 text-[13.5px] whitespace-pre-wrap break-words", mine ? "text-white rounded-tr-md" : "bg-[#f1f4f9] text-text rounded-tl-md border border-line"].join(" ")} style={mine ? { background: A } : undefined}>
                  {m.body}
                  {m.attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.attachments.map((a, i) => (
                        <button key={i} onClick={() => void view(a)} className={["flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] font-medium", mine ? "bg-white/15 text-white hover:bg-white/25" : "bg-white border border-line text-[#1e3a8a] hover:bg-[#f0f4fb]"].join(" ")}>
                          <span>{a.mime?.includes("pdf") ? "📄" : "🖼"}</span><span className="max-w-[130px] truncate">{a.name || "attachment"}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {mine && editId !== m.id && (
                <div className="flex gap-2 mt-0.5 justify-end pr-1">
                  <button onClick={() => { setEditId(m.id); setEditBody(m.body || ""); }} className="text-[11px] text-text-muted hover:text-[#1e3a8a]">Edit</button>
                  <button onClick={() => void remove(m)} className="text-[11px] text-text-muted hover:text-red-600">Delete</button>
                </div>
              )}
              {mine && m.id === lastMineId && otherSeenAt && new Date(otherSeenAt) >= new Date(m.created_at) && (
                <div className="text-[10.5px] text-[#178a5c] text-right mt-0.5 pr-1">Seen</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-line bg-white px-4 py-3 flex flex-col gap-2">
        {role === "admin" && (
          <div className="flex gap-1.5 flex-wrap">
            {MSG_TEMPLATES.map((t) => (
              <button key={t.label} onClick={() => toggleTemplate(t)}
                className={["text-[11px] px-2.5 py-1 rounded-full border transition-colors", usedTemplates.has(t.label) ? "bg-[#e8effc] border-[#1e3a8a] text-[#1e3a8a] font-semibold" : "border-line text-text-mid hover:border-[#1e3a8a] hover:text-[#1e3a8a]"].join(" ")}>
                {usedTemplates.has(t.label) ? "✓ " : ""}{t.label}
              </button>
            ))}
          </div>
        )}
        {role === "admin" && kind === "loan" && !requireKeys && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] text-text-muted">About (tap all that apply — the EPC’s Edit opens to every one):</span>
            <div className="flex flex-wrap gap-1.5">
              {DOC_TAGS.map((d) => {
                const on = docTags.includes(d.value);
                return (
                  <button key={d.value} type="button"
                    onClick={() => setDocTags((s) => on ? s.filter((x) => x !== d.value) : [...s, d.value])}
                    className={["text-[12px] px-2.5 py-1 rounded-full border transition-colors", on ? "bg-[#e8effc] border-[#1e3a8a] text-[#1e3a8a] font-semibold" : "border-line text-text-mid hover:border-[#1e3a8a]"].join(" ")}>
                    {on ? "✓ " : ""}{d.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {pending.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {pending.map((a, i) => (
              <span key={i} className="flex items-center gap-1.5 bg-[#f1f4f9] border border-line rounded-lg px-2 py-1 text-[11.5px]">
                <span>{a.mime?.includes("pdf") ? "📄" : "🖼"}</span><span className="max-w-[120px] truncate">{a.name}</span>
                <button onClick={() => setPending((p) => p.filter((_, j) => j !== i))} className="text-text-muted hover:text-red-600">✕</button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea ref={taRef} value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder={role === "admin" ? "Write a message to the EPC…" : "Reply to Capital Craft…"} className="flex-1 border border-line rounded-xl px-3 py-2 text-[13.5px] outline-none focus:border-[#1e3a8a] resize-none overflow-hidden min-h-[56px]" />
          <label className="shrink-0 w-10 h-10 grid place-items-center rounded-xl border border-line text-text-mid hover:border-[#1e3a8a] hover:text-[#1e3a8a] cursor-pointer" title="Attach photos / PDF">
            {uploading ? <span className="w-4 h-4 rounded-full border-2 border-[#1e3a8a]/30 border-t-[#1e3a8a] animate-spin" /> : "📎"}
            <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) void addFiles(e.target.files); e.currentTarget.value = ""; }} />
          </label>
          <button onClick={() => void send()} disabled={busy || uploading || (!body.trim() && pending.length === 0) || (requireKeys && (sendKeys?.length ?? 0) === 0)} className="shrink-0 h-10 px-4 rounded-xl text-white text-[13px] font-semibold disabled:opacity-50" style={{ background: A }}>
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
        {requireKeys && (sendKeys?.length ?? 0) === 0 && (
          <span className="text-[11.5px] text-amber-700">Select the fields or documents to open for editing (right) before sending.</span>
        )}
      </div>
    </div>
  );
}

function fmtWhen(iso: string): string {
  const d = new Date(iso), diff = Date.now() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}
