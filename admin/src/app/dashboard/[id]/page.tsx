"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import StatusBadge from "@/components/StatusBadge";
import { supabase } from "@/lib/supabase";
import { getSignedUrl } from "@/lib/storage";

type App = Record<string, any>;
type Doc = { id: string; category: string; storage_path: string; mime_type: string | null; file_name: string | null };

export default function LoanDetailPage() {
  return (
    <AuthGuard allow={["approved"]}>
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

  useEffect(() => {
    (async () => {
      const { data } = await supabase().from("epc_applications").select("*").eq("id", params.id).maybeSingle();
      setApp(data);
      const { data: d } = await supabase().from("user_application_docs")
        .select("id, category, storage_path, mime_type, file_name").eq("application_id", params.id);
      const rows = (d ?? []) as Doc[];
      setDocs(rows);
      const t: Record<string, string> = {};
      for (const row of rows) {
        if ((row.mime_type || "").startsWith("image/")) {
          const u = await getSignedUrl(row.storage_path);
          if (u) t[row.id] = u;
        }
      }
      setThumbs(t);
    })();
  }, [params.id]);

  if (!app) return null;

  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white">
        <div className="max-w-container mx-auto px-7 h-16 flex items-center justify-between">
          <a href="/dashboard" className="font-display font-bold text-[20px] grad-text">Capital Craft</a>
          <a href="/dashboard" className="text-[13px] text-text-muted hover:text-text">← Back to dashboard</a>
        </div>
      </header>

      <section className="max-w-[920px] mx-auto px-5 sm:px-7 py-10 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-[26px] sm:text-[30px] font-bold">{app.borrower_name || "Untitled"}</h1>
            <p className="text-text-mid mt-1">
              ₹{app.loan_amount ? Number(app.loan_amount).toLocaleString("en-IN") : "—"} &middot; created {new Date(app.created_at).toLocaleDateString("en-IN")}
            </p>
          </div>
          <StatusBadge status={app.status} />
        </div>

        <Section title="Borrower">
          <Row k="Mobile" v={app.borrower_mobile} />
          <Row k="Email" v={app.borrower_email} />
          <Row k="PAN" v={app.borrower_pan} />
          <Row k="DOB" v={app.borrower_dob} />
          <Row k="Address" v={app.borrower_address} />
          <Row k="City / State / Pincode" v={[app.borrower_city, app.borrower_state, app.borrower_pincode].filter(Boolean).join(", ") || null} />
        </Section>

        <Section title="Loan & system">
          <Row k="Loan amount" v={app.loan_amount && `₹${Number(app.loan_amount).toLocaleString("en-IN")}`} />
          <Row k="Tenure" v={app.tenure_months && `${app.tenure_months} months`} />
          <Row k="System capacity" v={app.system_capacity_kw && `${app.system_capacity_kw} kW`} />
          <Row k="System cost" v={app.system_cost && `₹${Number(app.system_cost).toLocaleString("en-IN")}`} />
          <Row k="Down payment" v={app.down_payment && `₹${Number(app.down_payment).toLocaleString("en-IN")}`} />
          <Row k="Install address" v={app.install_address} />
        </Section>

        <Section title="Credit context">
          <Row k="Monthly income" v={app.monthly_income && `₹${Number(app.monthly_income).toLocaleString("en-IN")}`} />
          <Row k="Employment type" v={app.employment_type} />
        </Section>

        <Card className="p-6">
          <h3 className="font-display font-semibold text-[16px] mb-3">Documents</h3>
          {docs.length === 0 ? (
            <p className="text-[13px] text-text-muted">No documents uploaded.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center gap-3 border border-line rounded-input bg-white px-3 py-2.5">
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
                    const u = await getSignedUrl(d.storage_path);
                    if (u) window.open(u, "_blank");
                  }} className="text-[12px] text-blue hover:underline">View</button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-6">
      <h3 className="font-display font-semibold text-[16px] mb-3">{title}</h3>
      <dl className="grid gap-1.5">{children}</dl>
    </Card>
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
