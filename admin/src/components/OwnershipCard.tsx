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
import { getBusiness, getToken } from "@/lib/auth";

type ModuleKey = "epcs" | "apps" | "loanleads" | "leads" | "insurance";

export default function OwnershipCard({
  module, recordId, createdByUserId, assignedToUserId, onChanged,
}: {
  module: ModuleKey;
  recordId: string;
  createdByUserId: string | null;
  assignedToUserId: string | null;
  onChanged?: (assignee: string | null) => void;
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
      const { data } = await supabase()
        .from("epc_business")
        .select("id, contact_name, role")
        .eq("business_type", "admin")
        .order("contact_name", { ascending: true });
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
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ module, record_id: recordId, assigned_to_user_id: next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) { alert(j?.error || "Reassign failed."); return; }
      setAssignee(next);
      onChanged?.(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Ownership" tint icon={I.users} adminOnly>
      <KV k="Created by" v={createdByUserId ? nameOf(createdByUserId) : "System / legacy"} />
      <KV k="Assigned to" v={assignee ? nameOf(assignee) : "Unassigned"} valueClass="text-[#185fa5]" />
      {isMainAdmin && (
        <div className="mt-2 pt-2 border-t border-[#eef3f0]">
          <div className="text-[12px] text-[#5a8a76] mb-1">Reassign to</div>
          <Select
            value={assignee ?? ""}
            onChange={(e) => void reassign(e.target.value)}
            disabled={busy}
            placeholder="Unassigned"
            options={[{ value: "", label: "Unassigned" }, ...team]}
          />
        </div>
      )}
    </SectionCard>
  );
}
