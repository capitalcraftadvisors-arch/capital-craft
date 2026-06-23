"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/StatusBadge";
import { supabase } from "@/lib/supabase";
import { getDocumentUrl } from "@/lib/storage";

type Biz = Record<string, any>;
type Doc = { id: string; category: string; stakeholder_id: string | null; storage_path: string; mime_type: string | null; file_name: string | null };

export default function AdminEpcDetailPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [biz, setBiz] = useState<Biz | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { void load(); }, [params.id]);
  async function load() {
    const { data: b } = await supabase().from("epc_business").select("*").eq("id", params.id).maybeSingle();
    setBiz(b);
    const { data: d } = await supabase().from("epc_documents")
      .select("id, category, stakeholder_id, storage_path, mime_type, file_name")
      .eq("business_id", params.id);
    const rows = (d ?? []) as Doc[];
    setDocs(rows);
    const t: Record<string, string> = {};
    for (const r of rows) {
      if ((r.mime_type || "").startsWith("image/")) {
        const u = await getDocumentUrl(r.id);
        if (u) t[r.id] = u;
      }
    }
    setThumbs(t);
  }

  async function changeStatus(next: "approved" | "on_hold" | "rejected" | "under_review") {
    if (!biz) return;
    setBusy(true);
    await supabase().from("epc_business").update({ status: next, ...(notes ? { /* no notes column on epc_business per schema; keep in mind */ } : {}) }).eq("id", biz.id);
    setBusy(false);
    void load();
  }

  if (!biz) return null;

  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white">
        <div className="max-w-container mx-auto px-7 h-16 flex items-center justify-between">
          <span className="font-display font-bold text-[20px] grad-text">Capital Craft / Admin</span>
          <a href="/admin" className="text-[13px] text-text-muted hover:text-text">← Back</a>
        </div>
      </header>

      <section className="max-w-[1000px] mx-auto px-5 sm:px-7 py-10 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-[26px] sm:text-[30px] font-bold">{biz.contact_name || "EPC"}</h1>
            <p className="text-text-mid mt-1">+91 {biz.contact_mobile} · {biz.business_type || "—"}</p>
          </div>
          <StatusBadge status={biz.status} />
        </div>

        <Section title="Profile">
          <Row k="PAN" v={biz.pan_number} />
          <Row k="Designation" v={biz.contact_designation} />
        </Section>

        <Section title="Bank">
          <Row k="Account" v={biz.bank_account_number} />
          <Row k="IFSC" v={biz.bank_ifsc} />
          <Row k="Branch" v={biz.bank_branch} />
          <Row k="Holder" v={biz.bank_account_holder} />
        </Section>

        <Section title="Members">
          {(biz.stakeholders ?? []).length === 0 ? <Empty /> : (biz.stakeholders ?? []).map((s: any) => {
            const sd = docs.filter((d) => d.stakeholder_id === s.id);
            return (
              <div key={s.id} className="py-3 border-t border-line first:border-0 first:pt-0">
                <p className="text-[14px] font-semibold">{s.name} <span className="text-text-muted font-normal">— {s.designation}</span></p>
                {sd.length > 0 && <DocList docs={sd} thumbs={thumbs} />}
              </div>
            );
          })}
        </Section>

        <Section title="References">
          {(biz.business_references ?? []).length === 0 ? <Empty /> : (biz.business_references ?? []).map((r: any, i: number) => (
            <Row key={i} k={`${r.type} — ${r.name}`} v={r.mobile} />
          ))}
        </Section>

        <Section title="Documents">
          <DocList docs={docs.filter((d) => !d.stakeholder_id)} thumbs={thumbs} />
        </Section>

        <Card className="p-6">
          <h3 className="font-display font-semibold text-[16px] mb-3">Review actions</h3>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Internal review notes (optional)"
            className="w-full border border-line rounded-input px-3.5 py-3 text-[14px] mb-3 min-h-[80px] focus:border-blue outline-none"
          />
          <div className="flex flex-wrap gap-3">
            {biz.status === "under_review" && <>
              <Button variant="grad" loading={busy} onClick={() => changeStatus("approved")}>Approve</Button>
              <Button variant="outline" loading={busy} onClick={() => changeStatus("on_hold")}>On hold</Button>
              <Button variant="outline" loading={busy} onClick={() => changeStatus("rejected")}>Reject</Button>
            </>}
            {biz.status === "on_hold" && <>
              <Button variant="grad" loading={busy} onClick={() => changeStatus("approved")}>Approve</Button>
              <Button variant="outline" loading={busy} onClick={() => changeStatus("rejected")}>Reject</Button>
            </>}
            {biz.status === "rejected" && (
              <Button variant="outline" loading={busy} onClick={() => changeStatus("under_review")}>Re-open</Button>
            )}
            {biz.status === "draft" && <p className="text-[13px] text-text-muted">EPC hasn&rsquo;t submitted yet.</p>}
            {biz.status === "approved" && <p className="text-[13px] text-text-muted">Approved. EPC has dashboard access.</p>}
          </div>
        </Card>
      </section>
    </main>
  );
}

function DocList({ docs, thumbs }: { docs: Doc[]; thumbs: Record<string, string> }) {
  if (docs.length === 0) return <p className="text-[13px] text-text-muted">No documents.</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 mt-2">
      {docs.map((d) => (
        <li key={d.id} className="flex items-center gap-3 bg-white border border-line rounded-input px-3 py-2.5">
          {thumbs[d.id] ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={thumbs[d.id]} alt="" className="w-10 h-10 object-cover rounded-md" />
          ) : (
            <div className="w-10 h-10 bg-bg-tint rounded-md grid place-items-center text-blue text-xs font-bold">PDF</div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] truncate">{d.file_name || d.category}</p>
            <p className="text-[11px] text-text-muted">{d.category}</p>
          </div>
          <button onClick={async () => {
            const u = await getDocumentUrl(d.id);
            if (u) window.open(u, "_blank");
          }} className="text-[12px] text-blue hover:underline">View</button>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-6">
      <h3 className="font-display font-semibold text-[16px] mb-3">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </Card>
  );
}
function Row({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex gap-4 text-[13px]">
      <dt className="text-text-muted min-w-[140px]">{k}</dt>
      <dd className="text-text">{v || <span className="text-text-muted">—</span>}</dd>
    </div>
  );
}
function Empty() { return <p className="text-[13px] text-text-muted">Nothing added.</p>; }
