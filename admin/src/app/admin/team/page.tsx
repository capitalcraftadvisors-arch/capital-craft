"use client";

// Team — /admin/team (main admin only). The CC team's logins: email each
// member's login password (migration 0094). EPC passwords are generated from
// each EPC profile's ⋮ menu.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import AdminSidebar from "@/components/AdminSidebar";
import SetPasswordModal from "@/components/SetPasswordModal";
import { supabase } from "@/lib/supabase";
import { getBusiness, isMainAdmin } from "@/lib/auth";
import { loginPasswordStatus } from "@/lib/passwords";
import { fmtDate } from "@/lib/dates";

export default function TeamPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

type Member = { id: string; contact_name: string | null; contact_mobile: string | null; contact_email: string | null; role: string | null };
const ROLE_LABEL: Record<string, string> = { MAIN_ADMIN: "Main admin", MANAGER: "Manager", OPERATIONS_USER: "Operations" };

function Inner() {
  const router = useRouter();
  const allowed = isMainAdmin(getBusiness());
  const [members, setMembers] = useState<Member[] | null>(null);
  const [pwSet, setPwSet] = useState<Map<string, string>>(new Map());
  const [editing, setEditing] = useState<Member | null>(null);

  useEffect(() => {
    if (!allowed) { router.replace("/admin"); return; }
    void (async () => {
      // team_accounts() (0096) lists the CC team without owner accounts.
      const { data } = await supabase().rpc("team_accounts");
      const list = (data ?? []) as Member[];
      setMembers(list);
      setPwSet(await loginPasswordStatus(list.map((m) => m.id)));
    })();
  }, [allowed, router]);

  async function closeModal() {
    setEditing(null);
    if (members) setPwSet(await loginPasswordStatus(members.map((m) => m.id)));
  }

  if (!allowed) return null;
  const th = "px-4 py-2.5 font-semibold text-left whitespace-nowrap";
  return (
    <div className="min-h-screen bg-bg-soft md:flex">
      <AdminSidebar active="team" />
      <div className="flex-1 min-w-0">
        <header className="px-4 sm:px-6 py-5 border-b border-line bg-white">
          <div className="flex items-center gap-2.5">
            <span className="inline-block w-1.5 h-7 rounded-full" style={{ backgroundColor: "#334155" }} />
            <h1 className="font-display text-[22px] sm:text-[26px] font-bold text-text">Team</h1>
          </div>
        </header>
        <main className="px-4 sm:px-6 py-5">
          <section className="bg-white border border-line rounded-xl overflow-x-auto">
            {!members ? (
              <p className="px-4 py-6 text-[13px] text-text-muted">Loading…</p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-text-muted">
                    <th className={th}>Name</th><th className={th}>Mobile</th><th className={th}>Role</th><th className={th}>Password</th><th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => {
                    const at = pwSet.get(m.id);
                    return (
                      <tr key={m.id} className="border-t border-line">
                        <td className="px-4 py-2.5 font-semibold text-text">{m.contact_name || "—"}</td>
                        <td className="px-4 py-2.5 text-text">{m.contact_mobile || "—"}</td>
                        <td className="px-4 py-2.5 text-text">{ROLE_LABEL[m.role ?? ""] ?? (m.role || "Admin")}</td>
                        <td className="px-4 py-2.5">
                          {at
                            ? <span className="text-[#178a5c] font-semibold">Set on {fmtDate(at)}</span>
                            : <span className="text-[#854f0b] font-semibold">Not set</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button type="button" onClick={() => setEditing(m)}
                            className="text-[12px] font-semibold px-3 py-1.5 rounded border border-line text-text hover:bg-bg-tint">
                            Login password
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </main>
      </div>
      {editing && (
        <SetPasswordModal
          open
          account={{ id: editing.id, name: editing.contact_name || "Team member", mobile: editing.contact_mobile, email: editing.contact_email }}
          onClose={() => void closeModal()}
        />
      )}
    </div>
  );
}
