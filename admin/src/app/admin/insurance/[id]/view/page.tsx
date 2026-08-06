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
import { I, SectionCard, KV, Pill, DocGrid, StatusBtn, type ViewDocSlot } from "@/components/view/ViewKit";
import InsuranceUpload from "@/components/InsuranceUpload";
import ProfileTabBar, { TabButton } from "@/components/ProfileTabBar";
import DeleteInsuranceModal from "@/components/DeleteInsuranceModal";
import { policyValidity } from "@/lib/insurance-validity";

type App = Record<string, any>;

function fmtRupees(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return "₹" + Math.round(Number(n)).toLocaleString("en-IN");
}
// DISPLAY-ONLY label for the insurer. The stored insurance_partner value is
// never changed and nothing keyed on it is affected; anything that isn't SBI
// renders exactly as stored.
function insurerLabel(v: string | null | undefined): string | null {
  if (!v) return v ?? null;
  return /^sbi\b/i.test(v.trim()) ? "SBI General Insurance" : v;
}
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", under_review: "Under Review", issued: "Issued", rejected: "Rejected", hold: "Hold",
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
  const [statusBusy, setStatusBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Policy document — OCR'd coverage dates, editable.
  const [policyFrom, setPolicyFrom] = useState("");
  const [policyTo, setPolicyTo] = useState("");
  const [policyDone, setPolicyDone] = useState(false);
  const [policySaved, setPolicySaved] = useState(false);

  // Seed the policy fields once the row loads.
  useEffect(() => {
    if (!app) return;
    setPolicyDone(!!app.policy_path);
    setPolicyFrom(app.policy_from_date ? String(app.policy_from_date).slice(0, 10) : "");
    setPolicyTo(app.policy_to_date ? String(app.policy_to_date).slice(0, 10) : "");
  }, [app]);

  async function savePolicy() {
    if (!app) return;
    setPolicySaved(false);
    const res = await fetch(`/api/admin/insurance/${app.id}/save-policy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
      body: JSON.stringify({ policy_from_date: policyFrom || null, policy_to_date: policyTo || null }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d?.ok) { setPolicySaved(true); setApp({ ...app, policy_from_date: policyFrom || null, policy_to_date: policyTo || null }); }
    else alert("Couldn't save policy dates: " + (d?.error || res.status));
  }

  // Admin moves the policy through Under Review → Issued / Hold / Rejected.
  async function changeStatus(next: "under_review" | "issued" | "hold" | "rejected") {
    if (!app || statusBusy || app.status === next) return;
    setStatusBusy(true);
    const { error } = await supabase()
      .from("insurance_applications")
      .update({ status: next })
      .eq("id", app.id);
    if (error) alert("Status update failed: " + error.message);
    else setApp({ ...app, status: next });
    setStatusBusy(false);
  }

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

  // Remove one *_path document via the admin-only route (nulls the column +
  // deletes exactly that GCS object + writes activity log) — immediate.
  async function removePathDoc(column: string) {
    try {
      const res = await fetch("/api/admin/delete-doc-path", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: JSON.stringify({ table: "insurance_applications", id: params.id, column }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) { alert("Couldn't remove: " + (d?.error || res.status)); return; }
      setApp((prev: App | null) => (prev ? { ...prev, [column]: null } : prev));
    } catch (e) {
      alert("Couldn't remove: " + (e as Error).message);
    }
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
    { key: "pan", label: "PAN card", path: app.pan_path, col: "pan_path" },
    { key: "aad_f", label: "Aadhaar (front)", path: app.aadhaar_front_path, col: "aadhaar_front_path" },
    { key: "aad_b", label: "Aadhaar (back)", path: app.aadhaar_back_path, col: "aadhaar_back_path" },
    { key: "gst", label: "GST certificate", path: app.gst_path, col: "gst_path" },
    { key: "ebill", label: "Electricity bill", path: app.ebill_path, col: "ebill_path" },
    { key: "plant", label: "Plant photo (geo-tagged)", path: app.plant_photo_path, col: "plant_photo_path" },
    { key: "invoice", label: "Final invoice", path: app.invoice_path, col: "invoice_path" },
    { key: "policy", label: "Insurance policy", path: app.policy_path, col: "policy_path" },
    // Legacy 3-photo set from the earlier build — shown only if present.
    ...(app.photo_panel_path ? [{ key: "panel", label: "Customer with panel (legacy)", path: app.photo_panel_path, col: "photo_panel_path" }] : []),
    ...(app.photo_inverter_path ? [{ key: "inverter", label: "Customer with inverter (legacy)", path: app.photo_inverter_path, col: "photo_inverter_path" }] : []),
    ...(app.photo_meter_path ? [{ key: "meter", label: "Customer with meter (legacy)", path: app.photo_meter_path, col: "photo_meter_path" }] : []),
  ].map((s) => ({
    key: s.key,
    label: s.label,
    onView: s.path ? () => void openPath(s.path as string) : undefined,
    onDelete: s.path ? () => void removePathDoc(s.col) : undefined,
  }));

  // Coordinates — the single plant photo, plus any legacy site photos.
  const GEO: { label: string; g: { lat?: number; lng?: number } | null }[] = [
    { label: "Plant photo GPS", g: app.plant_photo_gps ?? null },
    { label: "Panel photo GPS (legacy)", g: app.photo_panel_gps ?? null },
    { label: "Inverter photo GPS (legacy)", g: app.photo_inverter_gps ?? null },
    { label: "Meter photo GPS (legacy)", g: app.photo_meter_gps ?? null },
  ];

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[#cdeadd] bg-white sticky top-0 z-30">
        <div className="w-full px-5 sm:px-8 h-14 flex items-center justify-between">
          <button onClick={() => router.push("/admin")} className="text-[14px] text-[#5a8a76] hover:text-[#0f3d2e] inline-flex items-center gap-1">← Back to console</button>
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

        {/* ── TAB / ACTION ROW — tabs (left) + Delete (right). ── */}
        <ProfileTabBar
          left={
            <>
              <TabButton label="Application" icon={I.user} active />
              <TabButton label="Edit" icon={I.edit} onClick={() => router.push(`/dashboard/insurance/${app.id}/step-1` as any)} />
              <TabButton label="Download ZIP" icon={I.download} disabled={downloading} onClick={() => void downloadZip()} />
            </>
          }
          right={
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              title="Delete application" aria-label="Delete application"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-semibold border border-red-300 text-red-700 rounded-[8px] hover:bg-red-50 hover:border-red-500 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>
              Delete
            </button>
          }
        />

        {/* Status band — slate, like the other admin status controls. */}
        <div className="rounded-[12px] border border-slate-300 bg-slate-50 p-4 sm:p-5 mb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Insurance status <span className="normal-case font-normal text-slate-400">· admin only</span>
              </div>
              <span className="text-[18px] font-semibold text-slate-800">{STATUS_LABEL[app.status] ?? app.status}</span>
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              {app.status !== "under_review" && (
                <StatusBtn kind="neutral" busy={statusBusy} onClick={() => void changeStatus("under_review")}>Under review</StatusBtn>
              )}
              <StatusBtn kind="approve" busy={statusBusy} onClick={() => void changeStatus("issued")}>Issued</StatusBtn>
              <StatusBtn kind="neutral" busy={statusBusy} onClick={() => void changeStatus("hold")}>Hold</StatusBtn>
              <StatusBtn kind="danger" busy={statusBusy} onClick={() => void changeStatus("rejected")}>Rejected</StatusBtn>
            </div>
          </div>
        </div>

        {/* ── Insurance policy — under the status bar. Admin uploads the
            SBI-issued policy; we OCR the coverage period; dates editable. ── */}
        <SectionCard title="Insurance policy" accent="blue" icon={I.files} adminOnly>
          <p className="text-[12px] text-[#5a8a76] mb-3">
            Upload the policy issued by {insurerLabel(app.insurance_partner) || "the insurer"}. We&rsquo;ll read the coverage period; correct it if needed.
          </p>
          <div className="max-w-md">
            <InsuranceUpload
              endpoint={`/api/admin/insurance/${app.id}/extract-policy`}
              label="Policy document"
              hint="JPG, PNG, WEBP or PDF."
              initiallyDone={policyDone}
              onDone={(d) => {
                setPolicyDone(true);
                if (d.from) setPolicyFrom(String(d.from).slice(0, 10));
                if (d.to) setPolicyTo(String(d.to).slice(0, 10));
                setPolicySaved(false);
              }}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-3 mt-4 max-w-md">
            <div>
              <p className="text-[12px] text-[#5a8a76] mb-1">Coverage from</p>
              <input type="date" value={policyFrom} onChange={(e) => { setPolicyFrom(e.target.value); setPolicySaved(false); }}
                className="w-full border border-[#cdeadd] rounded-[8px] px-3 py-2.5 text-[14px] bg-white focus:border-[#185fa5] outline-none" />
            </div>
            <div>
              <p className="text-[12px] text-[#5a8a76] mb-1">Coverage to (renewal deadline)</p>
              <input type="date" value={policyTo} onChange={(e) => { setPolicyTo(e.target.value); setPolicySaved(false); }}
                className="w-full border border-[#cdeadd] rounded-[8px] px-3 py-2.5 text-[14px] bg-white focus:border-[#185fa5] outline-none" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <button type="button" onClick={() => void savePolicy()}
              className="px-4 py-2 bg-[#178a5c] text-white rounded text-[13px] font-semibold hover:bg-[#12734c]">Save policy dates</button>
            {policySaved && <span className="text-[12px] text-[#178a5c] font-medium">✓ Saved</span>}
            {policyFrom && policyTo && (
              <span className="text-[13px] font-semibold text-[#0f3d2e]">{policyValidity(policyFrom, policyTo)}</span>
            )}
          </div>
        </SectionCard>

        <div className="grid gap-4 lg:grid-cols-3 mt-4">
          <div className="flex flex-col gap-2.5">
            <SectionCard title="Applicant" accent="blue" icon={I.user}>
              <KV k="Name" v={app.aadhaar_name} />
              <KV k="PAN" v={app.pan_number} />
              <KV k="Aadhaar" v={app.aadhaar_number_masked} />
              <KV k="DOB" v={app.aadhaar_dob} />
              <KV k="Gender" v={app.aadhaar_gender} />
              <KV k="Care of" v={app.aadhaar_care_of} />
              <KV k="Address" v={app.aadhaar_address} />
              {(app.gstin || app.gst_legal_name) && (
                <>
                  <KV k="GST legal name" v={app.gst_legal_name} />
                  <KV k="GST trade name" v={app.gst_trade_name} />
                  <KV k="GSTIN" v={app.gstin} />
                </>
              )}
            </SectionCard>
          </div>

          <div className="flex flex-col gap-2.5">
            <SectionCard title="Plant & invoice" accent="green" icon={I.money}>
              <KV k="Sum insured" v={fmtRupees(app.sum_insured ?? app.invoice_confirmed_amount)} valueClass="text-[#178a5c]" />
              <KV k="Insurance partner" v={insurerLabel(app.insurance_partner)} />
              <KV k="Plant address" v={app.plant_address} />
              <KV k="Final invoice amount" v={fmtRupees(app.invoice_confirmed_amount)} />
              <KV k="OCR amount" v={fmtRupees(app.invoice_amount)} />
              {GEO.map((x) => (
                x.g && x.g.lat != null
                  ? <KV key={x.label} k={x.label} v={`${x.g.lat?.toFixed?.(5)}, ${x.g.lng?.toFixed?.(5)}`} />
                  : null
              ))}
            </SectionCard>

          </div>

          <div className="flex flex-col gap-2.5">
            <SectionCard title="Documents" accent="green" icon={I.files}>
              <DocGrid slots={docSlots} eyeIcon={I.eye} />
            </SectionCard>
          </div>
        </div>

      </div>

      <DeleteInsuranceModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDeleted={(payload) => {
          setDeleteOpen(false);
          alert(`Deleted ${payload.display_id ?? "insurance application"}${payload.applicant ? ` — ${payload.applicant}` : ""}.`);
          router.push("/admin");
        }}
        applicationId={app.id}
        displayId={app.insurance_display_id ?? null}
        applicant={app.aadhaar_name ?? null}
      />
    </main>
  );
}
