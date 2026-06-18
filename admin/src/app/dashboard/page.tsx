"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/StatusBadge";
import { logout } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type AppRow = {
  id: string;
  borrower_name: string | null;
  loan_amount: number | null;
  status: string;
  created_at: string;
};

export default function DashboardPage() {
  return (
    <AuthGuard allow={["approved"]}>
      <DashboardInner />
    </AuthGuard>
  );
}

function DashboardInner() {
  const router = useRouter();
  const [rows, setRows] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase()
        .from("epc_applications")
        .select("id, borrower_name, loan_amount, status, created_at")
        .order("created_at", { ascending: false });
      setRows((data ?? []) as AppRow[]);
      setLoading(false);
    })();
  }, []);

  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white">
        <div className="max-w-container mx-auto px-7 h-16 flex items-center justify-between">
          <a href="/" className="font-display font-bold text-[20px] grad-text">Capital Craft</a>
          <button onClick={() => { logout(); router.replace("/login"); }} className="text-[13px] text-text-muted hover:text-text">
            Log out
          </button>
        </div>
      </header>

      <section className="max-w-container mx-auto px-5 sm:px-7 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-[26px] sm:text-[30px] font-bold">Loan applications</h1>
            <p className="text-text-mid mt-1">All applications you&rsquo;ve created.</p>
          </div>
          <Button variant="primary" onClick={() => router.push("/dashboard/new")}>+ New application</Button>
        </div>

        <Card className="overflow-hidden">
          <table className="w-full text-[14px]">
            <thead className="bg-bg-soft border-b border-line">
              <tr className="text-left text-text-muted">
                <th className="px-5 py-3 font-medium">Borrower</th>
                <th className="px-5 py-3 font-medium">Loan amount</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-text-muted">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-12 text-center text-text-muted">
                  No applications yet. Click <span className="text-text">+ New application</span> to create one.
                </td></tr>
              ) : rows.map((r) => (
                <tr key={r.id}
                    onClick={() => router.push(`/dashboard/${r.id}` as any)}
                    className="border-b border-line cursor-pointer hover:bg-bg-soft transition-colors">
                  <td className="px-5 py-4">{r.borrower_name || "—"}</td>
                  <td className="px-5 py-4">{r.loan_amount ? `₹${Number(r.loan_amount).toLocaleString("en-IN")}` : "—"}</td>
                  <td className="px-5 py-4"><StatusBadge status={r.status} /></td>
                  <td className="px-5 py-4 text-text-muted">{new Date(r.created_at).toLocaleDateString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </main>
  );
}
