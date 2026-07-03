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
      {rows.map((r) => (
        <li
          key={r.id}
          className="border-l-4 border-[#cdeadd] pl-4 py-2 bg-[#f7fcfa] rounded-r-[8px]"
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[14px] text-[#0f3d2e]">{describe(r)}</p>
            <span className="text-[11px] text-[#5a8a76] shrink-0">{fmtDate(r.created_at)}</span>
          </div>
          <p className="text-[12px] text-[#5a8a76] mt-0.5 capitalize">
            by {actorLabel(r.actor)}
          </p>
        </li>
      ))}
    </ol>
  );
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
