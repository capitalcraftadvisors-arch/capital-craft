"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import StatusBadge from "@/components/StatusBadge";
import { supabase } from "@/lib/supabase";
import { logout } from "@/lib/auth";

type Tab = "epcs" | "apps";

export default function AdminHomePage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("epcs");
  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white">
        <div className="max-w-container mx-auto px-7 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-display font-bold text-[20px] grad-text">Capital Craft</span>
            <span className="text-[12px] px-2 py-0.5 rounded-full bg-bg-tint text-blue-dark font-semibold uppercase tracking-wide">Admin</span>
          </div>
          <button onClick={() => { logout(); router.replace("/login"); }} className="text-[13px] text-text-muted hover:text-text">
            Log out
          </button>
        </div>
      </header>

      <section className="max-w-container mx-auto px-5 sm:px-7 py-10">
        <h1 className="font-display text-[26px] sm:text-[30px] font-bold mb-6">Ops console</h1>

        <div className="flex gap-2 mb-6 border-b border-line">
          <TabBtn active={tab === "epcs"} onClick={() => setTab("epcs")}>EPCs</TabBtn>
          <TabBtn active={tab === "apps"} onClick={() => setTab("apps")}>Loan applications</TabBtn>
        </div>

        {tab === "epcs" ? <EpcsTab /> : <AppsTab />}
      </section>
    </main>
  );
}

function TabBtn({ active, children, ...rest }: any) {
  return (
    <button
      {...rest}
      className={[
        "px-4 py-2.5 text-[14px] font-semibold border-b-2 transition-colors",
        active ? "border-blue text-blue" : "border-transparent text-text-muted hover:text-text",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function EpcsTab() {
  const router = useRouter();
  type Row = { id: string; contact_name: string | null; contact_mobile: string | null; business_type: string | null; status: string; submitted_at: string | null };
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    (async () => {
      let query = supabase().from("epc_business")
        .select("id, contact_name, contact_mobile, business_type, status, submitted_at")
        .neq("business_type", "admin")
        .order("submitted_at", { ascending: false, nullsFirst: false });
      if (statusFilter) query = query.eq("status", statusFilter);
      const { data } = await query;
      setRows((data ?? []) as Row[]);
    })();
  }, [statusFilter]);

  const filtered = q.trim()
    ? rows.filter((r) =>
        (r.contact_name || "").toLowerCase().includes(q.toLowerCase()) ||
        (r.contact_mobile || "").includes(q))
    : rows;

  return (
    <>
      <div className="grid sm:grid-cols-[1fr_220px] gap-3 mb-5">
        <Input placeholder="Search by name or mobile…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select
          placeholder="All statuses"
          options={[
            { value: "draft", label: "Draft" },
            { value: "under_review", label: "Under review" },
            { value: "approved", label: "Approved" },
            { value: "on_hold", label: "On hold" },
            { value: "rejected", label: "Rejected" },
          ]}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        />
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-[14px]">
          <thead className="bg-bg-soft border-b border-line text-left text-text-muted">
            <tr>
              <th className="px-5 py-3 font-medium">EPC name</th>
              <th className="px-5 py-3 font-medium">Mobile</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-text-muted">No EPCs match.</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.id} onClick={() => router.push(`/admin/epc/${r.id}` as any)}
                  className="border-b border-line cursor-pointer hover:bg-bg-soft transition-colors">
                <td className="px-5 py-4">{r.contact_name || "—"}</td>
                <td className="px-5 py-4">+91 {r.contact_mobile}</td>
                <td className="px-5 py-4 capitalize">{r.business_type || "—"}</td>
                <td className="px-5 py-4"><StatusBadge status={r.status} /></td>
                <td className="px-5 py-4 text-text-muted">{r.submitted_at ? new Date(r.submitted_at).toLocaleDateString("en-IN") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function AppsTab() {
  const router = useRouter();
  type Row = {
    id: string; borrower_name: string | null; loan_amount: number | null;
    status: string; created_at: string; created_by: string;
    epc_business: { contact_name: string | null } | null;
  };
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    (async () => {
      let query = supabase()
        .from("epc_applications")
        .select("id, borrower_name, loan_amount, status, created_at, created_by, epc_business:epc_business_id(contact_name)")
        .order("created_at", { ascending: false });
      if (statusFilter) query = query.eq("status", statusFilter);
      const { data } = await query;
      setRows((data ?? []) as unknown as Row[]);
    })();
  }, [statusFilter]);

  const filtered = q.trim()
    ? rows.filter((r) =>
        (r.borrower_name || "").toLowerCase().includes(q.toLowerCase()) ||
        (r.epc_business?.contact_name || "").toLowerCase().includes(q.toLowerCase()))
    : rows;

  return (
    <>
      <div className="grid sm:grid-cols-[1fr_220px] gap-3 mb-5">
        <Input placeholder="Search by borrower or EPC…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select
          placeholder="All statuses"
          options={[
            { value: "draft", label: "Draft" },
            { value: "submitted", label: "Submitted" },
            { value: "under_review", label: "Under review" },
            { value: "approved", label: "Approved" },
            { value: "on_hold", label: "On hold" },
            { value: "rejected", label: "Rejected" },
            { value: "sent_to_nbfc", label: "Sent to NBFC" },
            { value: "disbursed", label: "Disbursed" },
          ]}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        />
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-[14px]">
          <thead className="bg-bg-soft border-b border-line text-left text-text-muted">
            <tr>
              <th className="px-5 py-3 font-medium">Borrower</th>
              <th className="px-5 py-3 font-medium">EPC</th>
              <th className="px-5 py-3 font-medium">Amount</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Created</th>
              <th className="px-5 py-3 font-medium">By</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-text-muted">No applications match.</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.id} onClick={() => router.push(`/admin/app/${r.id}` as any)}
                  className="border-b border-line cursor-pointer hover:bg-bg-soft transition-colors">
                <td className="px-5 py-4">{r.borrower_name || "—"}</td>
                <td className="px-5 py-4">{r.epc_business?.contact_name || "—"}</td>
                <td className="px-5 py-4">{r.loan_amount ? `₹${Number(r.loan_amount).toLocaleString("en-IN")}` : "—"}</td>
                <td className="px-5 py-4"><StatusBadge status={r.status} /></td>
                <td className="px-5 py-4 text-text-muted">{new Date(r.created_at).toLocaleDateString("en-IN")}</td>
                <td className="px-5 py-4 text-text-muted capitalize">{r.created_by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
