"use client";

// Pri portal — /admin/pri. The owner's private console (migration 0096): only
// an owner login sees it (sidebar + this page); the main admin, managers and
// RMs never do. Holds the Claude connector links and the owner's own login
// password (typed by the owner — nobody else can set it).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import AdminSidebar from "@/components/AdminSidebar";
import ClaudeConnectorCard from "@/components/ClaudeConnectorCard";
import Input from "@/components/ui/Input";
import { supabase } from "@/lib/supabase";
import { getBusiness } from "@/lib/auth";
import { loginPasswordStatus } from "@/lib/passwords";
import { fmtDate } from "@/lib/dates";

export default function PriPortalPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const router = useRouter();
  const me = getBusiness();
  const allowed = !!me?.is_owner;
  useEffect(() => { if (!allowed) router.replace("/admin"); }, [allowed, router]);
  if (!allowed || !me) return null;

  return (
    <div className="min-h-screen bg-bg-soft md:flex">
      <AdminSidebar active="pri" />
      <div className="flex-1 min-w-0">
        <header className="px-4 sm:px-6 py-5 border-b border-line bg-white">
          <div className="flex items-center gap-2.5">
            <span className="inline-block w-1.5 h-7 rounded-full" style={{ backgroundColor: "#7c2d12" }} />
            <h1 className="font-display text-[22px] sm:text-[26px] font-bold text-text">Pri portal</h1>
          </div>
        </header>
        <main className="px-4 sm:px-6 py-5">
          <MyPasswordCard id={me.id} />
          <ClaudeConnectorCard />
        </main>
      </div>
    </div>
  );
}

// The owner types their own password (strong rule enforced by the database).
function MyPasswordCard({ id }: { id: string }) {
  const [setAt, setSetAt] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void loginPasswordStatus([id]).then((m) => setSetAt(m.get(id) ?? null)); }, [id]);

  async function save() {
    if (busy) return;
    setError(null); setMsg(null);
    if (/\s/.test(pw)) { setError("No spaces in the password."); return; }
    if (pw.length < 12 || !/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/[0-9]/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) {
      setError("Use 12+ characters with a capital letter, a small letter, a number and a symbol."); return;
    }
    if (pw !== pw2) { setError("The two passwords don't match."); return; }
    setBusy(true);
    const { data, error: e } = await supabase().rpc("set_login_password", { p_business_id: id, p_password: pw });
    setBusy(false);
    if (e) { setError("Couldn't save — " + e.message); return; }
    setSetAt(String(data)); setPw(""); setPw2(""); setMsg("Password saved.");
  }

  const eye = (
    <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}
      className="p-1.5 rounded text-text-muted hover:text-text">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 12s3.5-7 10.5-7 10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" /><circle cx="12" cy="12" r="3" /></svg>
    </button>
  );
  return (
    <section className="bg-white border border-line rounded-xl">
      <div className="px-4 py-3 border-b border-line flex items-center gap-2">
        <h2 className="text-[15px] font-bold text-text">My login password</h2>
        <span className="text-[12px] text-text-muted">{setAt ? `set on ${fmtDate(setAt)}` : "not set"}</span>
      </div>
      <div className="px-4 py-4 grid sm:grid-cols-2 gap-3 max-w-2xl">
        <Input label="New password" type={show ? "text" : "password"} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} rightSlot={eye} />
        <Input label="Confirm password" type={show ? "text" : "password"} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
      </div>
      {error && <p className="mx-4 mb-3 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-[8px] px-3 py-2">{error}</p>}
      {msg && <p className="mx-4 mb-3 text-[13px] text-[#178a5c] bg-[#e6f6ee] border border-[#cdeadd] rounded-[8px] px-3 py-2">{msg}</p>}
      <div className="px-4 pb-4">
        <button type="button" onClick={() => void save()} disabled={busy || !pw}
          className="text-[13px] font-semibold px-4 py-2 rounded-[8px] bg-[#178a5c] text-white hover:bg-[#12734c] disabled:opacity-60">
          {busy ? "Saving…" : "Save password"}
        </button>
      </div>
    </section>
  );
}
