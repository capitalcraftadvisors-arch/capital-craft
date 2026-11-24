"use client";

// Ownership card — reusable across every module's View page. Shows who CREATED
// a record and who it's ASSIGNED to (resolved from user ids → names), and lets
// a MAIN_ADMIN reassign it. Created-by is display-only and never changes;
// reassignment goes through /api/admin/reassign, which preserves created_by and
// appends to user_activity_log.
//
// Drop-in: <OwnershipCard module="apps" recordId={id}
//            createdByUserId={r.created_by_user_id} assignedToUserId={r.assigned_to_user_id} />

import { useEffect, useState } from "react";
import Select from "@/components/ui/Select";
import { I, SectionCard, KV } from "@/components/view/ViewKit";
import { supabase } from "@/lib/supabase";
import { getBusiness, authHeaders } from "@/lib/auth";
import { notify } from "@/lib/notify";

type ModuleKey = "epcs" | "apps" | "loanleads" | "leads" | "insurance";

export default function OwnershipCard({
  module, recordId, createdByUserId, assignedToUserId, onChanged, bare,
}: {
  module: ModuleKey;
  recordId: string;
  createdByUserId: string | null;
  assignedToUserId: string | null;
  onChanged?: (assignee: string | null) => void;
  bare?: boolean; // contents only — the page supplies its own (flat) section
}) {
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [team, setTeam] = useState<{ value: string; label: string }[]>([]);
  const [assignee, setAssignee] = useState<string | null>(assignedToUserId);
  const [busy, setBusy] = useState(false);

  const me = getBusiness();
  const isMainAdmin =
    me?.role === "MAIN_ADMIN" ||
    (me?.business_type === "admin" && (me?.allowed_modules ?? []).includes("analytics"));

  useEffect(() => { setAssignee(assignedToUserId); }, [assignedToUserId]);

  useEffect(() => {
    void (async () => {
      // CC team, owner accounts left out (0096).
      const { data } = await supabase().rpc("team_accounts");
      const rows = (data ?? []) as { id: string; contact_name: string | null; role: string | null }[];
      setNames(new Map(rows.map((r) => [r.id, r.contact_name || "(unnamed)"])));
      setTeam(rows.map((r) => ({
        value: r.id,
        label: (r.contact_name || "(unnamed)") + (r.role === "MAIN_ADMIN" ? " · Main Admin" : ""),
      })));
    })();
  }, []);

  const nameOf = (id: string | null) => (id ? names.get(id) ?? "—" : "—");

  async function reassign(v: string) {
    const next = v || null;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/reassign", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ module, record_id: recordId, assigned_to_user_id: next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { notify.error(j?.error || "Reassign failed."); return; }
      setAssignee(next);
      onChanged?.(next);
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <>
      <KV k="Created by" v={createdByUserId ? nameOf(createdByUserId) : "System / legacy"} />
      <KV k="Assigned to" v={assignee ? nameOf(assignee) : "Unassigned"} valueClass="text-cc-blue" />
      {isMainAdmin && (
        <div className="mt-2 pt-2 border-t border-cc-track">
          <div className="text-[12px] text-cc-muted mb-1">Reassign to</div>
          <Select
            value={assignee ?? ""}
            onChange={(e) => void reassign(e.target.value)}
            disabled={busy}
            placeholder="Unassigned"
            options={[{ value: "", label: "Unassigned" }, ...team]}
          />
        </div>
      )}
    </>
  );
  if (bare) return body;
  return (
    <SectionCard title="Ownership" tint icon={I.users} adminOnly>
      {body}
    </SectionCard>
  );
}
