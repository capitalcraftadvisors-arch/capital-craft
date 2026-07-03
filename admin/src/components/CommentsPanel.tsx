"use client";

// Admin-only comments panel for a single EPC.
//
// Reads/writes epc_comments directly via Supabase using the admin JWT.
// Admin-only RLS on epc_comments guarantees EPCs never see this data.
// Every INSERT / UPDATE / DELETE also lands in admin_edit_log automatically
// via the trigger in migration 0018 — no application-side audit call needed.
//
// UX:
//   - Newest first list.
//   - Each row: author name + relative time + text.
//   - Rows authored by the CURRENT admin show inline Edit / Delete.
//   - Add-comment form pinned at the bottom.
//   - Editing a row swaps it into an inline textarea with Save / Cancel.

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { supabase } from "@/lib/supabase";
import { getBusiness } from "@/lib/auth";

export type CommentRow = {
  id: string;
  business_id: string;
  author_id: string | null;
  author_name: string | null;
  comment_text: string;
  created_at: string;
  updated_at: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  businessId: string;
  epcName?: string | null;
  onChanged?: () => void;  // notify parent after any add/edit/delete
};

export default function CommentsPanel({
  open, onClose, businessId, epcName, onChanged,
}: Props) {
  const [rows, setRows] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const me = getBusiness();
  const myId = me?.id ?? null;

  async function load() {
    setLoading(true);
    const { data, error } = await supabase()
      .from("epc_comments")
      .select("id, business_id, author_id, author_name, comment_text, created_at, updated_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });
    if (error) console.warn("[comments] load failed:", error.message);
    setRows((data ?? []) as CommentRow[]);
    setLoading(false);
  }

  useEffect(() => { if (open) void load(); }, [open, businessId]);

  if (!open) return null;

  async function add() {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    const { error } = await supabase().from("epc_comments").insert({
      business_id: businessId,
      author_id: myId,
      author_name: me?.contact_name ?? null,
      comment_text: t,
    });
    setBusy(false);
    if (error) { alert("Couldn't save comment: " + error.message); return; }
    setText("");
    await load();
    onChanged?.();
  }

  async function saveEdit(id: string) {
    const t = editingText.trim();
    if (!t) return;
    setBusy(true);
    const { error } = await supabase()
      .from("epc_comments")
      .update({ comment_text: t })
      .eq("id", id);
    setBusy(false);
    if (error) { alert("Couldn't update: " + error.message); return; }
    setEditingId(null);
    setEditingText("");
    await load();
    onChanged?.();
  }

  async function remove(id: string) {
    if (!confirm("Delete this comment? This can't be undone.")) return;
    setBusy(true);
    const { error } = await supabase().from("epc_comments").delete().eq("id", id);
    setBusy(false);
    if (error) { alert("Couldn't delete: " + error.message); return; }
    await load();
    onChanged?.();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-white rounded-lg shadow-lg flex flex-col max-h-[90vh]"
      >
        <div className="p-5 border-b border-line flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-[18px] text-text truncate">
              Comments{epcName ? ` — ${epcName}` : ""}
            </h3>
            <p className="text-[12px] text-text-mid mt-0.5">Admin-only. EPCs never see these notes.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[20px] text-text-muted hover:text-text leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {loading ? (
            <p className="text-[13px] text-text-muted">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-[13px] text-text-muted">No comments yet — add the first one below.</p>
          ) : (
            rows.map((r) => {
              const mine = r.author_id && myId && r.author_id === myId;
              const isEditing = editingId === r.id;
              return (
                <div key={r.id} className="border border-line rounded-input p-3 bg-bg-soft">
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <div className="text-[12px] text-text-mid">
                      <span className="font-semibold text-text">{r.author_name || "Admin"}</span>
                      <span className="mx-1 text-text-muted">·</span>
                      <span>{fmtWhen(r.created_at)}</span>
                      {r.updated_at !== r.created_at && (
                        <span className="ml-2 text-[11px] text-text-muted italic">(edited)</span>
                      )}
                    </div>
                    {mine && !isEditing && (
                      <div className="flex gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => { setEditingId(r.id); setEditingText(r.comment_text); }}
                          className="text-[12px] text-blue hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(r.id)}
                          className="text-[12px] text-text-muted hover:text-red-500"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        rows={3}
                        className="w-full border border-line rounded-input px-3 py-2 text-[13px] bg-white focus:border-blue outline-none"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => { setEditingId(null); setEditingText(""); }}
                          className="text-[12px] px-2.5 py-1 border border-line rounded hover:border-blue"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={busy || !editingText.trim()}
                          onClick={() => saveEdit(r.id)}
                          className="text-[12px] px-3 py-1 bg-blue text-white rounded hover:bg-blue-dark disabled:opacity-50"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[13px] text-text whitespace-pre-wrap">{r.comment_text}</p>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="p-4 border-t border-line bg-white">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="Add a comment for internal review…"
            className="w-full border border-line rounded-input px-3 py-2 text-[13px] bg-white focus:border-blue outline-none"
          />
          <div className="mt-2 flex justify-end">
            <Button type="button" variant="primary" onClick={add} loading={busy} disabled={!text.trim()}>
              Add comment
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}
