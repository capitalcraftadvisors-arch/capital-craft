"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import StatusBadge from "@/components/StatusBadge";
import FileUpload from "@/components/FileUpload";
import { supabase } from "@/lib/supabase";
import { getDocumentUrl } from "@/lib/storage";
import { getBusiness } from "@/lib/auth";

type App = Record<string, any>;
type Doc = { id: string; category: string; storage_path: string; mime_type: string | null; file_name: string | null };
type StatusEntry = { from: string; to: string; by: string; at: string; note: string };

const DOC_CATEGORIES = [
  "borrower_pan","borrower_aadhaar","borrower_photo",
  "bank_statement","income_proof","electricity_bill",
  "property_doc","quotation","other",
] as const;

export default function AdminAppDetailPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [app, setApp] = useState<App | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<App>({});
  const [notes, setNotes] = useState("");
  const [nbfc, setNbfc] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { void load(); }, [params.id]);

  async function load() {
    const { data: a } = await supabase().from("epc_applications").select("*").eq("id", params.id).maybeSingle();
    setApp(a); setForm(a || {});
    setNotes(a?.review_notes || "");
    const { data: d } = await supabase().from("user_application_docs")
      .select("id, category, storage_path, mime_type, file_name")
      .eq("application_id", params.id);
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

  async function saveEdits() {
    setBusy(true);
    const payload: Record<string, any> = {};
    for (const k of [
      "borrower_name","borrower_mobile","borrower_email","borrower_pan","borrower_dob",
      "borrower_address","borrower_pincode","borrower_city","borrower_state",
      "loan_amount","tenure_months","system_capacity_kw","system_cost","down_payment",
      "install_address","monthly_income","employment_type",
    ]) payload[k] = form[k] || null;
    payload.review_notes = notes || null;
    await supabase().from("epc_applications").update(payload).eq("id", params.id);
    setEditing(false);
    setBusy(false);
    void load();
  }

  async function transitionStatus(to: string, extra: Record<string, any> = {}) {
    if (!app) return;
    setBusy(true);
    const admin = getBusiness();
    const entry: StatusEntry = {
      from: app.status, to,
      by: admin?.contact_name || "admin",
      at: new Date().toISOString(),
      note: notes || "",
    };
    const history: StatusEntry[] = Array.isArray(app.status_history) ? [...app.status_history, entry] : [entry];
    const update: Record<string, any> = {
      status: to,
      status_history: history,
      reviewed_by: admin?.contact_name || "admin",
      reviewed_at: new Date().toISOString(),
      review_notes: notes || null,
      ...extra,
    };
    if (to === "sent_to_nbfc") update.nbfc_submitted_at = new Date().toISOString();
    if (to === "disbursed") update.nbfc_decision = "approved";
    await supabase().from("epc_applications").update(update).eq("id", params.id);
    setBusy(false);
    void load();
  }

  if (!app) return null;

  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white print:hidden">
        <div className="max-w-container mx-auto px-7 h-16 flex items-center justify-between">
          <span className="font-display font-bold text-[20px] grad-text">Capital Craft / Admin</span>
          <div className="flex items-center gap-4">
            <a href="/admin" className="text-[13px] text-text-muted hover:text-text">← Back</a>
            <button onClick={() => window.print()} className="text-[13px] text-blue hover:underline">Print summary</button>
          </div>
        </div>
      </header>

      <section className="max-w-[1000px] mx-auto px-5 sm:px-7 py-10 space-y-5">
        <div className="flex items-center justify-between print:hidden">
          <div>
            <h1 className="font-display text-[26px] sm:text-[30px] font-bold">{app.borrower_name || "Untitled"}</h1>
            <p className="text-text-mid mt-1">
              ₹{app.loan_amount ? Number(app.loan_amount).toLocaleString("en-IN") : "—"}
              {" · "}created {new Date(app.created_at).toLocaleDateString("en-IN")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={app.status} />
            {!editing && <Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>}
          </div>
        </div>

        {/* Editable section */}
        <Card className="p-6">
          <h3 className="font-display font-semibold text-[16px] mb-3">Borrower & loan</h3>
          {editing ? (
            <div className="grid gap-5 sm:grid-cols-2">
              {[
                ["borrower_name","Borrower name"],["borrower_mobile","Mobile"],
                ["borrower_email","Email"],["borrower_pan","PAN"],
                ["borrower_dob","DOB","date"],["borrower_pincode","Pincode"],
                ["borrower_city","City"],["borrower_state","State"],
                ["loan_amount","Loan amount","number"],["tenure_months","Tenure (months)","number"],
                ["system_capacity_kw","Capacity (kW)","number"],["system_cost","System cost","number"],
                ["down_payment","Down payment","number"],["monthly_income","Monthly income","number"],
                ["employment_type","Employment"],
              ].map(([k,label,type]) => (
                <Input key={k as string} label={label as string} type={(type as string) || "text"}
                       value={form[k as string] ?? ""} onChange={(e) => setForm({ ...form, [k as string]: e.target.value })} />
              ))}
              <div className="sm:col-span-2">
                <Input label="Address" value={form.borrower_address ?? ""} onChange={(e) => setForm({ ...form, borrower_address: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Input label="Install address" value={form.install_address ?? ""} onChange={(e) => setForm({ ...form, install_address: e.target.value })} />
              </div>
              <div className="sm:col-span-2 flex gap-3 justify-end">
                <Button variant="outline" onClick={() => { setEditing(false); setForm(app); }}>Cancel</Button>
                <Button variant="primary" loading={busy} onClick={saveEdits}>Save</Button>
              </div>
            </div>
          ) : (
            <dl className="grid gap-1.5">
              <Row k="Mobile" v={app.borrower_mobile} />
              <Row k="Email" v={app.borrower_email} />
              <Row k="PAN" v={app.borrower_pan} />
              <Row k="Loan amount" v={app.loan_amount && `₹${Number(app.loan_amount).toLocaleString("en-IN")}`} />
              <Row k="Tenure" v={app.tenure_months && `${app.tenure_months} months`} />
              <Row k="System capacity" v={app.system_capacity_kw && `${app.system_capacity_kw} kW`} />
              <Row k="Install address" v={app.install_address} />
              <Row k="Monthly income" v={app.monthly_income && `₹${Number(app.monthly_income).toLocaleString("en-IN")}`} />
              <Row k="Employment" v={app.employment_type} />
            </dl>
          )}
        </Card>

        <Card className="p-6 print:hidden">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-[16px]">Documents</h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {DOC_CATEGORIES.map((c) => (
              <div key={c} className="p-4 bg-bg-soft rounded-input border border-line">
                <FileUpload
                  applicationId={params.id}
                  table="user_application_docs"
                  category={c as any}
                  maxFiles={c === "borrower_pan" || c === "borrower_photo" ? 1 : 5}
                  uploadedBy="admin"
                  label={c.replace(/_/g, " ")}
                />
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-6 print:hidden">
          <h3 className="font-display font-semibold text-[16px] mb-3">Review</h3>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Review notes"
            className="w-full border border-line rounded-input px-3.5 py-3 text-[14px] min-h-[80px] focus:border-blue outline-none" />
          <div className="mt-3 flex flex-wrap gap-3">
            {app.status === "submitted" && (
              <Button variant="primary" loading={busy} onClick={() => transitionStatus("under_review")}>Start review</Button>
            )}
            {app.status === "under_review" && <>
              <Button variant="grad" loading={busy} onClick={() => transitionStatus("approved")}>Approve</Button>
              <Button variant="outline" loading={busy} onClick={() => transitionStatus("on_hold")}>On hold</Button>
              <Button variant="outline" loading={busy} onClick={() => transitionStatus("rejected")}>Reject</Button>
            </>}
            {app.status === "on_hold" && (
              <Button variant="primary" loading={busy} onClick={() => transitionStatus("under_review")}>Back to review</Button>
            )}
            {app.status === "approved" && (
              <div className="flex gap-2 items-end">
                <Input label="NBFC name" value={nbfc} onChange={(e) => setNbfc(e.target.value)} />
                <Button variant="grad" loading={busy} disabled={!nbfc.trim()} onClick={() => transitionStatus("sent_to_nbfc", { nbfc_name: nbfc.trim() })}>
                  Send to NBFC
                </Button>
              </div>
            )}
            {app.status === "sent_to_nbfc" && <>
              <Button variant="grad" loading={busy} onClick={() => transitionStatus("disbursed")}>Mark disbursed</Button>
              <Button variant="outline" loading={busy} onClick={() => transitionStatus("rejected", { nbfc_decision: "rejected", nbfc_decision_at: new Date().toISOString() })}>NBFC rejected</Button>
            </>}
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="font-display font-semibold text-[16px] mb-3">Status history</h3>
          <ol className="space-y-2">
            {(app.status_history ?? []).length === 0 ? (
              <p className="text-[13px] text-text-muted">No transitions yet.</p>
            ) : (app.status_history ?? []).map((h: StatusEntry, i: number) => (
              <li key={i} className="flex items-start gap-3 text-[13px] border-l-2 border-blue pl-3">
                <span className="text-text-muted shrink-0">{new Date(h.at).toLocaleString("en-IN")}</span>
                <span><span className="capitalize">{h.from}</span> → <span className="capitalize font-semibold">{h.to}</span>
                  {h.note && <span className="text-text-muted"> · {h.note}</span>}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </section>
    </main>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex gap-4 text-[13px]">
      <dt className="text-text-muted min-w-[160px]">{k}</dt>
      <dd className="text-text">{v || <span className="text-text-muted">—</span>}</dd>
    </div>
  );
}
