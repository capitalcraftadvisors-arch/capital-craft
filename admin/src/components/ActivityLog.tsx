"use client";

// Chronological audit feed for one EPC. Reads admin_edit_log directly via
// Supabase (admin JWT + admin_all_edit_log policy). Renders one line per
// event with a human-readable action, actor + timestamp.
//
// Covers ALL event sources — no matter whether the row was written by:
//   - The admin from the detail page (field_edit, doc_upload, doc_replace,
//     doc_delete, members_edited, references_edited)
//   - The EPC's self-edit submit flow (same actions with actor='epc')
//   - The comment trigger in migration 0018 (comment_add / _edit / _delete)
//   - The lender-status trigger in migration 0018 (lender_approve /
//     _unapprove / _docs_given / _docs_ungiven)
//
// If an action string comes back that we don't yet have a friendly label
// for, we fall back to displaying the raw action + field so nothing is
// silently dropped.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type LogRow = {
  id: string;
  actor: string;                 // "admin" | "epc" — plus, defensively, any others
  actor_id: string;
  action: string;                // free text; enum-adjacent
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
};

type Props = {
  businessId: string;
  refreshKey?: number;           // bump to force a re-fetch
};

export default function ActivityLog({ businessId, refreshKey }: Props) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase()
        .from("admin_edit_log")
        .select("id, actor, actor_id, action, field, old_value, new_value, created_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      setRows((data ?? []) as LogRow[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [businessId, refreshKey]);

  if (loading) return <p className="text-[13px] text-[#5a8a76]">Loading activity…</p>;
  if (rows.length === 0) return <p className="text-[13px] text-[#5a8a76]">No activity recorded yet.</p>;

  return (
    <ol className="space-y-2">
      {rows.map((r) => {
        const icon = iconFor(r);
        return (
          <li
            key={r.id}
            className="border-l-4 border-[#cdeadd] pl-4 py-2 bg-[#f7fcfa] rounded-r-[8px]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <span className={["shrink-0 mt-0.5", icon.tone].join(" ")}>{icon.svg}</span>
                <p className="text-[14px] text-[#0f3d2e]">{describe(r)}</p>
              </div>
              <span className="text-[11px] text-[#5a8a76] shrink-0">{fmtDate(r.created_at)}</span>
            </div>
            <p className="text-[12px] text-[#5a8a76] mt-0.5 pl-[26px] capitalize">
              by {actorLabel(r.actor)}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

// ── Per-action icons ─────────────────────────────────────────────────

type IconChoice = { svg: React.ReactNode; tone: string };

const SVG_PROPS = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const I_PENCIL      = (<svg {...SVG_PROPS}><path d="M17 3l4 4-13 13H4v-4z"/></svg>);
const I_TARGET      = (<svg {...SVG_PROPS}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>);
const I_UPLOAD      = (<svg {...SVG_PROPS}><path d="M12 4v13m0-13-5 5m5-5 5 5M4 20h16"/></svg>);
const I_REFRESH     = (<svg {...SVG_PROPS}><path d="M4 12a8 8 0 0 1 14-5l3-3M20 12a8 8 0 0 1-14 5l-3 3M17 4h4v4M7 20H3v-4"/></svg>);
const I_TRASH       = (<svg {...SVG_PROPS}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6"/></svg>);
const I_USERS       = (<svg {...SVG_PROPS}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>);
const I_STAR        = (<svg {...SVG_PROPS}><path d="M12 2 15.09 8.26 22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>);
const I_SEND        = (<svg {...SVG_PROPS}><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>);
const I_CHECK_CIRC  = (<svg {...SVG_PROPS}><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>);
const I_X_CIRC      = (<svg {...SVG_PROPS}><circle cx="12" cy="12" r="10"/><path d="m9 9 6 6M15 9l-6 6"/></svg>);
const I_FILE_PLUS   = (<svg {...SVG_PROPS}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 12v6M9 15h6"/></svg>);
const I_FILE_MINUS  = (<svg {...SVG_PROPS}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15h6"/></svg>);
const I_CHAT        = (<svg {...SVG_PROPS}><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z"/></svg>);
const I_CHAT_PLUS   = (<svg {...SVG_PROPS}><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z"/><path d="M12 8v6M9 11h6"/></svg>);
const I_CHAT_X      = (<svg {...SVG_PROPS}><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z"/><path d="m10 9 4 4M14 9l-4 4"/></svg>);
const I_DOT         = (<svg {...SVG_PROPS}><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>);

function iconFor(r: LogRow): IconChoice {
  const NEUTRAL = "text-[#5a8a76]";
  const GREEN   = "text-[#178a5c]";
  const BLUE    = "text-[#185fa5]";
  const AMBER   = "text-[#854f0b]";
  const RED     = "text-red-600";

  switch (r.action) {
    case "field_edit":
      return r.field === "status"
        ? { svg: I_TARGET, tone: BLUE }
        : { svg: I_PENCIL, tone: BLUE };
    case "doc_upload":         return { svg: I_UPLOAD, tone: GREEN };
    case "doc_replace":        return { svg: I_REFRESH, tone: BLUE };
    case "doc_delete":         return { svg: I_TRASH, tone: RED };
    case "members_edited":     return { svg: I_USERS, tone: BLUE };
    case "references_edited":  return { svg: I_STAR, tone: BLUE };
    case "self_edit_submit":   return { svg: I_SEND, tone: BLUE };
    case "lender_approve":     return { svg: I_CHECK_CIRC, tone: GREEN };
    case "lender_unapprove":   return { svg: I_X_CIRC, tone: AMBER };
    case "lender_docs_given":  return { svg: I_FILE_PLUS, tone: GREEN };
    case "lender_docs_ungiven":return { svg: I_FILE_MINUS, tone: AMBER };
    case "comment_add":        return { svg: I_CHAT_PLUS, tone: GREEN };
    case "comment_edit":       return { svg: I_CHAT, tone: BLUE };
    case "comment_delete":     return { svg: I_CHAT_X, tone: RED };
    default:                   return { svg: I_DOT, tone: NEUTRAL };
  }
}

function actorLabel(actor: string): string {
  if (actor === "admin") return "admin";
  if (actor === "epc")   return "the EPC";
  return actor;
}

function describe(r: LogRow): string {
  const oldV = clip(r.old_value);
  const newV = clip(r.new_value);
  const field = r.field ?? "";

  switch (r.action) {
    case "field_edit":
      if (field === "status") {
        return `Internal status changed from ${prettyStatus(oldV)} to ${prettyStatus(newV)}`;
      }
      if (oldV && newV) return `Edited ${prettyField(field)} · ${oldV} → ${newV}`;
      if (newV)         return `Set ${prettyField(field)} to ${newV}`;
      return `Edited ${prettyField(field)}`;
    case "doc_upload":       return `Uploaded ${prettyField(field)} document`;
    case "doc_replace":      return `Replaced ${prettyField(field)} document`;
    case "doc_delete":       return `Removed ${prettyField(field)} document`;
    case "members_edited":   return `Updated stakeholders`;
    case "references_edited":return `Updated references`;
    case "self_edit_submit": return `Submitted self-edit changes`;

    case "lender_approve":       return `Approved ${prettyLender(field)}`;
    case "lender_unapprove":     return `Un-approved ${prettyLender(field)}`;
    case "lender_docs_given":    return `Marked docs given for ${prettyLender(field)}`;
    case "lender_docs_ungiven":  return `Un-marked docs given for ${prettyLender(field)}`;

    case "comment_add":    return `Added a comment${newV ? `: “${newV}”` : ""}`;
    case "comment_edit":   return `Edited a comment${newV ? `: “${newV}”` : ""}`;
    case "comment_delete": return `Deleted a comment${oldV ? `: “${oldV}”` : ""}`;
  }

  // Unknown action — surface raw values so nothing is silently swallowed.
  return `${r.action}${field ? ` (${field})` : ""}${newV ? ` — ${newV}` : ""}`;
}

function prettyField(f: string): string {
  return f
    .replace(/_/g, " ")
    .replace(/\bpan\b/i, "PAN")
    .replace(/\bifsc\b/i, "IFSC")
    .replace(/\bgstin\b/i, "GSTIN");
}

function prettyLender(f: string): string {
  if (f === "creditfair") return "CreditFair";
  if (f === "aerem")      return "Aerem";
  if (f === "solfin")     return "Solfin";
  return f || "lender";
}

function prettyStatus(s: string): string {
  switch (s) {
    case "draft":        return "Draft";
    case "under_review": return "Under review";
    case "approved":     return "Approved";
    case "on_hold":      return "On hold";
    case "rejected":     return "Rejected";
    default:             return s || "—";
  }
}

function clip(s: string | null): string {
  if (!s) return "";
  const t = s.length > 120 ? s.slice(0, 120) + "…" : s;
  return t;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}
