"use client";

// Admin maintenance tools. Standalone page (reach it at /admin/tools).

import { useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { getToken } from "@/lib/auth";

export default function ToolsPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [stats, setStats] = useState({ processed: 0, fixed: 0, noFace: 0, failed: 0 });

  async function runBackfill() {
    if (running) return;
    setRunning(true); setDone(false);
    setStats({ processed: 0, fixed: 0, noFace: 0, failed: 0 });
    let after = "";
    try {
      // Loop batches until the server reports it's done.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res = await fetch("/api/admin/backfill-aadhaar-faces", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
          body: JSON.stringify({ limit: 15, after }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.ok) { alert(j?.error || "Backfill failed."); break; }
        setStats((s) => ({
          processed: s.processed + j.processed,
          fixed: s.fixed + j.fixed,
          noFace: s.noFace + j.noFace,
          failed: s.failed + (j.failed || 0),
        }));
        after = j.nextAfter;
        if (j.done) { setDone(true); break; }
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg-soft p-6 sm:p-10">
      <button onClick={() => router.push("/admin")} className="text-[13px] text-text-muted hover:text-text mb-6">← Console</button>
      <h1 className="font-display text-[22px] sm:text-[26px] font-bold text-text mb-5">Tools</h1>

      <div className="rounded-xl border border-line bg-white p-5 max-w-md">
        <div className="text-[15px] font-semibold text-text">Straighten applicant photos</div>
        <p className="text-[13px] text-text-muted mt-1">
          Re-generates the applicant face from every stored Aadhaar and fixes rotated or missing
          photos across all loan applications. Safe to run more than once.
        </p>
        <button
          onClick={runBackfill}
          disabled={running}
          className="mt-4 px-4 py-2 rounded-lg bg-[#178a5c] text-white text-[13px] font-semibold hover:bg-[#12734c] disabled:opacity-60"
        >
          {running ? "Fixing…" : "Run"}
        </button>
        {(running || done) && (
          <div className="mt-3 text-[13px] text-text-mid">
            Processed {stats.processed} · Fixed {stats.fixed} · No face {stats.noFace}
            {stats.failed ? ` · Failed ${stats.failed}` : ""}
            {done && <span className="text-[#178a5c] font-semibold"> · Done</span>}
          </div>
        )}
      </div>
    </div>
  );
}
