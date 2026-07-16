"use client";

// Insurance application — full-page View for admin. Structural sibling of the
// loan View, on the SAME ViewKit (header card, SectionCard, KV, Pill, DocGrid)
// so it matches the rest of the console. Docs stored as *_path columns are
// viewed via the admin-only sign-doc route.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import { getToken } from "@/lib/auth";
import { I, SectionCard, KV, Pill, DocGrid, type ViewDocSlot } from "@/components/view/ViewKit";

type App = Record<string, any>;

function fmtRupees(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return "₹" + Math.round(Number(n)).toLocaleString("en-IN");
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", submitted: "Submitted", under_review: "Under Review", approved: "Approved", rejected: "Rejected",
};

export default function InsuranceViewPage() {
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
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase()
        .from("insurance_applications")
        .select("*, epc_business:epc_business_id(contact_name, trade_name, legal_name, epc_display_id)")
        .eq("id", params.id)
        .maybeSingle();
      setApp(data);
      setLoading(false);
    })();
  }, [params.id]);

  const epcName = useMemo(() => {
    if (!app?.epc_business) return "—";
    return app.epc_business.trade_name || app.epc_business.legal_name || app.epc_business.contact_name || "—";
  }, [app]);

  async function openPath(path: string) {
    try {
      const res = await fetch(`/api/admin/insurance/${params.id}/sign-doc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ path }),
      });
      const d = await res.json().catch(() => ({}));
      if (d?.ok && d.url) window.open(d.url, "_blank", "noopener");
    } catch { /* ignore */ }
  }

  async function downloadZip() {
    if (!app || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/admin/insurance/${app.id}/download-zip`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert("ZIP failed: " + (d?.error || `HTTP ${res.status}`)); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const cd = res.headers.get("content-disposition") || "";
      const m = /filename="?([^"]+)"?/.exec(cd);
      const a = document.createElement("a");
      a.href = url;
      a.download = m?.[1] || `${app.insurance_display_id || app.id.slice(0, 8)}.zip`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { alert("Download failed: " + (e as Error).message); }
    finally { setDownloading(false); }
  }

  if (loading) return <main className="min-h-screen grid place-items-center"><p className="text-[#5a8a76]">Loading…</p></main>;
  if (!app) return <main className="min-h-screen grid place-items-center"><p className="text-red-700">Insurance application not found.</p></main>;

  const docSlots: ViewDocSlot[] = [
    { key: "pan", label: "PAN card", path: app.pan_path },
    { key: "aad_f", label: "Aadhaar (front)", path: app.aadhaar_front_path },
    { key: "aad_b", label: "Aadhaar (back)", path: app.aadhaar_back_path },
    { key: "gst", label: "GST certificate", path: app.gst_path },
    { key: "plant", label: "Plant photo (geo-tagged)", path: app.plant_photo_path },
    { key: "invoice", label: "Invoice", path: app.invoice_path },
  ].map((s) => ({ key: s.key, label: s.label, onView: s.path ? () => void openPath(s.path as string) : undefined }));

  const gps = app.plant_photo_gps as { lat?: number; lng?: number } | null;

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[#cdeadd] bg-white sticky top-0 z-30">
        <div className="w-full px-5 sm:px-8 h-14 flex items-center justify-between">
          <button onClick={() => router.push("/admin")} className="text-[14px] text-[#5a8a76] hover:text-[#0f3d2e] inline-flex items-center gap-1">← Back</button>
          <span className="font-display font-bold text-[18px] text-[#0f3d2e]">Capital Craft</span>
        </div>
      </header>

      <div className="w-full px-5 sm:px-8 py-6" style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#0f3d2e" }}>
        <div className="rounded-[12px] border border-[#cdeadd] bg-[#f0faf5] p-5 sm:p-6 mb-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-14 h-14 rounded-[12px] bg-[#d6efe3] text-[#178a5c] grid place-items-center shrink-0" style={{ transform: "scale(1.3)", transformOrigin: "left center" }}>{I.user}</div>
              <div className="min-w-0">
                <div className="text-[24px] font-semibold text-[#0f3d2e] truncate">{app.aadhaar_name || "(unnamed)"}</div>
                <div className="text-[14px] text-[#5a8a76] truncate mt-0.5">via {epcName}</div>
              </div>
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <Pill tint="blue" icon={I.id}>{app.insurance_display_id ?? app.id.slice(0, 8).toUpperCase()}</Pill>
              {app.pan_number && <Pill tint="blue">PAN {app.pan_number}</Pill>}
              <Pill tint="amber">{STATUS_LABEL[app.status] ?? app.status}</Pill>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-2.5">
            <SectionCard title="Applicant" accent="blue" icon={I.user}>
              <KV k="Name" v={app.aadhaar_name} />
              <KV k="PAN" v={app.pan_number} />
              <KV k="Aadhaar" v={app.aadhaar_number_masked} />
              <KV k="DOB" v={app.aadhaar_dob} />
              <KV k="Gender" v={app.aadhaar_gender} />
              <KV k="Care of" v={app.aadhaar_care_of} />
              <KV k="Address" v={app.aadhaar_address} />
            </SectionCard>
          </div>

          <div className="flex flex-col gap-2.5">
            <SectionCard title="Plant & invoice" accent="green" icon={I.money}>
              <KV k="Plant address" v={app.plant_address} />
              <KV k="Invoice amount" v={fmtRupees(app.invoice_confirmed_amount ?? app.invoice_amount)} valueClass="text-[#178a5c]" />
              <KV k="OCR amount" v={fmtRupees(app.invoice_amount)} />
              {gps && (gps.lat != null) && <KV k="Plant GPS" v={`${gps.lat?.toFixed?.(5)}, ${gps.lng?.toFixed?.(5)}`} />}
            </SectionCard>

            <SectionCard title="Submission" accent="green" icon={I.check}>
              <KV k="Current step" v={String(app.current_step ?? "—")} />
              <KV k="Step 1 done" v={fmtDate(app.step1_completed_at)} />
              <KV k="Step 2 done" v={fmtDate(app.step2_completed_at)} />
              <KV k="Submitted" v={fmtDate(app.submitted_at)} valueClass="text-[#178a5c]" />
            </SectionCard>
          </div>

          <div className="flex flex-col gap-2.5">
            <SectionCard title="Documents" accent="green" icon={I.files}>
              <DocGrid slots={docSlots} eyeIcon={I.eye} />
            </SectionCard>
          </div>
        </div>

        <div className="flex gap-3 mt-4">
          <button type="button" onClick={() => router.push(`/dashboard/insurance/${app.id}/step-1` as any)}
            className="flex-1 py-3.5 text-[15px] font-semibold bg-[#178a5c] text-white rounded-[10px] hover:bg-[#12734c] inline-flex items-center justify-center gap-2">
            {I.edit} Edit application
          </button>
          <button type="button" onClick={() => void downloadZip()} disabled={downloading}
            className="flex-1 py-3.5 text-[15px] font-semibold bg-[#185fa5] text-white rounded-[10px] hover:bg-[#144d84] disabled:opacity-70 inline-flex items-center justify-center gap-2">
            {I.download} {downloading ? "Preparing…" : "Download ZIP"}
          </button>
        </div>
      </div>
    </main>
  );
}
