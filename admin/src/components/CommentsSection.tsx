"use client";

// Inline "chat-box" comments component. Rendered on:
//   - the View page (Col 3, replacing the old "Latest comment" card)
//   - the Edit Profile page (below the removed Review actions)
//
// Layout:
//   ┌────────────────────────────────────────────────┐
//   │ Add a new comment                              │
//   │ ┌──────────────────────────────┐  ┌────────┐  │
//   │ │  textarea                     │  │  Add   │  │
//   │ └──────────────────────────────┘  └────────┘  │
//   ├────────────────────────────────────────────────┤
//   │ scrollable list (max-h ~360px)  newest first   │
//   │  ● Neha Sharma · 12 Mar 4:07 PM      Edit Delete│
//   │    Look at the GST reg — trade name blank.     │
//   │  ● Raj Patel · 10 Mar 1:15 PM                  │
//   │    Ok, checking.                               │
//   │  …                                             │
//   └────────────────────────────────────────────────┘
//
// Same Supabase CRUD as CommentsPanel — admin-only RLS + audit trigger
// (migration 0018) means every add/edit/delete lands in admin_edit_log
// automatically. onChanged fires so the View page can bump its activity
// log refresh key.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getBusiness } from "@/lib/auth";
import type { CommentRow } from "@/components/CommentsPanel";

type Props = {
  businessId: string;
  epcName?: string | null;
  onChanged?: () => void;
  // Optional height cap for the scroll list.
  maxListHeight?: number;
};

export default function CommentsSection({
  businessId, onChanged, maxListHeight = 360,
}: Props) {
  const [rows, setRows] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const me = getBusiness();
  const myId = me?.id ?? null;

  async function load() {
    setLoading(true);
    const { data, error } = await supabase()
      .from("epc_comments")
      .select("id, business_id, author_id, author_name, comment_text, created_at, updated_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });
    if (error) console.warn("[comments-section] load failed:", error.message);
    setRows((data ?? []) as CommentRow[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [businessId]);

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

  // Comments are permanent (audit-style): no edit, no delete. Edits are
  // also blocked server-side by RLS (migration 0039).

  return (
    <div className="space-y-3">
      {/* Add form */}
      <div>
        <div className="flex gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="Add a new comment…"
            className="flex-1 min-w-0 border border-line rounded-input px-3 py-2 text-[13px] bg-white focus:border-blue outline-none resize-none"
          />
          <button
            type="button"
            onClick={add}
            disabled={busy || !text.trim()}
            className="shrink-0 self-start px-4 py-2 bg-[#178a5c] text-white text-[13px] font-semibold rounded-input hover:bg-[#12734c] disabled:opacity-50"
          >
            {busy ? "Saving…" : "Add"}
          </button>
        </div>
        <p className="text-[11px] text-text-muted mt-1">
          Admin-only note. EPCs never see these.
        </p>
      </div>

      {/* Scrollable list */}
      <div
        className="border border-[#cdeadd] rounded-input bg-white overflow-y-auto"
        style={{ maxHeight: maxListHeight }}
      >
        {loading ? (
          <p className="text-[13px] text-text-muted p-4">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-text-muted p-4">No comments yet — add the first one above.</p>
        ) : (
          <ul className="divide-y divide-[#eaf3ee]">
            {rows.map((r) => (
              <li key={r.id} className="p-3">
                <div className="text-[12px] text-text-mid min-w-0 mb-1">
                  <span className="font-semibold text-[#0f3d2e]">{r.author_name || "Admin"}</span>
                  <span className="mx-1 text-text-muted">·</span>
                  <span>{fmtWhen(r.created_at)}</span>
                  {r.updated_at !== r.created_at && (
                    <span className="ml-2 text-[11px] text-text-muted italic">(edited)</span>
                  )}
                </div>
                <p className="text-[13px] text-[#0f3d2e] whitespace-pre-wrap break-words">{r.comment_text}</p>
              </li>
            ))}
          </ul>
        )}
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
