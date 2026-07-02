"use client";

// Full-page dense 3-column EPC dashboard.
// Read-only summary — for editing, admin clicks "Edit profile" to jump to
// /admin/epc/[id] (the existing editable detail flow).
//
// Colors (brand palette from the approved reference):
//   #178a5c  primary green
//   #185fa5  sky blue accent
//   #0f3d2e  dark green text
//   #5a8a76  muted green text
//   #f0faf5  light green tint (admin-only sections)
//   #dceffb  light blue tint (pills)
//   #cdeadd  green card border
//   #d3e9f7  blue card border
//   #fef0d6  amber pill bg
//   #854f0b  amber pill text

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import { getToken } from "@/lib/auth";
import { getDocumentUrl } from "@/lib/storage";
import { logAudit } from "@/lib/auditLog";

export default function AdminEpcViewPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

type Biz = Record<string, any>;
type Doc = {
  id: string;
  category: string;
  file_name: string | null;
  mime_type: string | null;
  stakeholder_id: string | null;
  metadata: Record<string, unknown> | null;
};
type LenderRow = { lender: string; docs_given: boolean; approved: boolean };
type AdminInfo = {
  team_size: string | null;
  capacity_residential: number | null;
  capacity_residential_unit: "KW" | "MW" | null;
  capacity_commercial: number | null;
  capacity_commercial_unit: "KW" | "MW" | null;
  turnover_last_fy: string | null;
};

const BUSINESS_TYPE_LABEL: Record<string, string> = {
  proprietorship: "Proprietorship",
  pvt_ltd:        "Private Limited",
  partnership:    "Partnership",
  llp:            "LLP",
};

function peopleHeading(bt: string | null | undefined): string {
  switch (bt) {
    case "proprietorship": return "Proprietor details";
    case "pvt_ltd":        return "Director details";
    case "partnership":
    case "llp":            return "Partner details";
    default:               return "Member details";
  }
}

function roleLabel(bt: string | null | undefined): string {
  switch (bt) {
    case "proprietorship": return "Proprietor";
    case "pvt_ltd":        return "Director";
    case "partnership":
    case "llp":            return "Partner";
    default:               return "Member";
  }
}

function DOC_LABEL(cat: string): string {
  const M: Record<string, string> = {
    pan_business: "PAN card",
    gstin: "GST reg.",
    extra_doc: "Extra doc",
    cancelled_cheque: "Cheque",
    stakeholder_pan: "Member PAN",
    stakeholder_aadhaar: "Aadhaar (legacy)",
    stakeholder_aadhaar_front: "Aadhaar F",
    stakeholder_aadhaar_back: "Aadhaar B",
    office_exterior: "Office ext",
    office_interior: "Office int",
    office_selfie: "Selfie",
    gst_r3b: "GST R3B",
  };
  return M[cat] ?? cat;
}

function maskAcct(a: string | null | undefined): string {
  if (!a) return "—";
  if (a.length <= 4) return "•".repeat(6) + a;
  return "•".repeat(Math.max(6, a.length - 4)) + a.slice(-4);
}

function maskMobile(m: string | null | undefined): string {
  if (!m) return "—";
  return m.length === 10 ? "•••••" + m.slice(5) : m;
}

// ── Icons ──────────────────────────────────────────────────────────
const I = {
  building: (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="1" /><path d="M9 21V9M15 21V9M4 9h16M9 6h.01M15 6h.01M9 13h.01M15 13h.01M9 17h.01M15 17h.01" />
    </svg>
  ),
  user: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>),
  users: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>),
  bank: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M3 10h18M12 3 2 8h20l-10-5zM4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/></svg>),
  files: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15h6M9 11h4"/></svg>),
  star: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 15.09 8.26 22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>),
  lock: (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>),
  money: (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/></svg>),
  invoice: (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2h9l5 5v15H6z"/><path d="M15 2v6h5M9 12h6M9 16h6M9 8h3"/></svg>),
  check: (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7"/></svg>),
  send: (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>),
  circleCheck: (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>),
  eye: (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 12s3.5-7 10.5-7 10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>),
  edit: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3l4 4-13 13H4v-4z"/></svg>),
  download: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16"/></svg>),
  id: (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="9" cy="12" r="2"/><path d="M14 10h5M14 14h5"/></svg>),
};

function Inner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [biz, setBiz] = useState<Biz | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [lender, setLender] = useState<LenderRow[]>([]);
  const [adminInfo, setAdminInfo] = useState<AdminInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const [{ data: b }, { data: d }, { data: l }, { data: ai }] = await Promise.all([
        supabase().from("epc_business").select("*").eq("id", params.id).maybeSingle(),
        supabase().from("epc_documents").select("id, category, file_name, mime_type, stakeholder_id, metadata").eq("business_id", params.id),
        supabase().from("epc_lender_status").select("lender, docs_given, approved").eq("business_id", params.id),
        supabase().from("epc_admin_info").select("*").eq("business_id", params.id).maybeSingle(),
      ]);
      setBiz(b);
      setDocs((d ?? []) as Doc[]);
      setLender((l ?? []) as LenderRow[]);
      setAdminInfo((ai as AdminInfo | null) ?? null);
    })();
  }, [params.id]);

  const r3bDocs = useMemo(() => docs.filter((d) => d.category === "gst_r3b"), [docs]);
  const r3bTotal = useMemo(
    () => r3bDocs.reduce((s, d) => {
      const v = (d.metadata as { total_taxable_value?: number } | null)?.total_taxable_value;
      return typeof v === "number" && !isNaN(v) ? s + v : s;
    }, 0),
    [r3bDocs],
  );
  const nonR3bDocs = useMemo(() => docs.filter((d) => d.category !== "gst_r3b"), [docs]);
  const stakeholders = ((biz?.stakeholders ?? []) as Array<{ id: string; name?: string; designation?: string; mobile?: string; email?: string }>);
  const refs = ((biz?.business_references ?? []) as Array<{ type: "customer" | "supplier"; name: string; mobile: string }>);
  const customers = refs.filter((r) => r.type === "customer");
  const suppliers = refs.filter((r) => r.type === "supplier");

  const docsGivenCount = lender.filter((l) => l.docs_given).length;
  const anyApproved = lender.some((l) => l.approved);

  async function openDoc(id: string) {
    const u = await getDocumentUrl(id);
    if (u) window.open(u, "_blank");
  }

  // Internal status transitions — writes to epc_business.status (admin's
  // internal tracking field) and logs to admin_edit_log. This mirrors the
  // detail page's changeStatus. IMPORTANT: this DOES NOT unlock the EPC's
  // loan application — only a lender "Approved" tick does that.
  async function changeStatus(next: "approved" | "on_hold" | "rejected" | "under_review") {
    if (!biz || statusBusy) return;
    setStatusBusy(true);
    try {
      const { error } = await supabase()
        .from("epc_business")
        .update({ status: next })
        .eq("id", biz.id);
      if (error) {
        alert("Status update failed: " + error.message);
        return;
      }
      await logAudit(biz.id, "field_edit", "status", biz.status, next);
      setBiz({ ...biz, status: next });
    } finally {
      setStatusBusy(false);
    }
  }

  async function downloadZip() {
    if (!biz || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/epc/${biz.id}/download-zip`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const cd = res.headers.get("content-disposition") || "";
      const m = /filename="?([^"]+)"?/.exec(cd);
      const a = document.createElement("a");
      a.href = url;
      a.download = m?.[1] || `EPC_${biz.id.slice(0, 8)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Download failed: " + (e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  if (!biz) return <div className="p-10 text-center text-[#5a8a76]">Loading…</div>;

  const trade = biz.trade_name || biz.legal_name || biz.contact_name || "—";
  const legalSub = biz.legal_name && biz.trade_name && biz.legal_name !== biz.trade_name
    ? `Legal: ${biz.legal_name}` : null;
  const btLabel = BUSINESS_TYPE_LABEL[biz.business_type ?? ""] ?? biz.business_type;

  const proprietorLabel = biz.business_type === "proprietorship" ? "Proprietorship" : btLabel;

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[#cdeadd] bg-white sticky top-0 z-30">
        <div className="w-full px-5 sm:px-8 h-14 flex items-center justify-between">
          <button
            onClick={() => router.push("/admin")}
            className="text-[14px] text-[#5a8a76] hover:text-[#0f3d2e] inline-flex items-center gap-1"
          >
            ← Back
          </button>
          <span className="font-display font-bold text-[18px] text-[#0f3d2e]">Capital Craft</span>
        </div>
      </header>

      <div className="w-full px-5 sm:px-8 py-6" style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#0f3d2e" }}>

        {/* ── HEADER CARD ─────────────────────────────────────────── */}
        <div className="rounded-[12px] border border-[#cdeadd] bg-[#f0faf5] p-5 sm:p-6 mb-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-14 h-14 rounded-[12px] bg-[#d6efe3] text-[#178a5c] grid place-items-center shrink-0" style={{ transform: "scale(1.3)", transformOrigin: "left center" }}>
                {I.building}
              </div>
              <div className="min-w-0">
                <div className="text-[24px] font-semibold text-[#0f3d2e] truncate">{trade}</div>
                {legalSub && <div className="text-[14px] text-[#5a8a76] truncate mt-0.5">{legalSub}</div>}
              </div>
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              {biz.epc_display_id && (
                <Pill tint="blue" icon={I.id}>{biz.epc_display_id}</Pill>
              )}
              {btLabel && <Pill tint="blue">{btLabel}</Pill>}
              {biz.gstin_number && <Pill tint="blue">GSTIN {biz.gstin_number}</Pill>}
              {biz.pm_surya_ghar && (
                <Pill tint="blue">
                  PM Surya Ghar: {biz.pm_surya_ghar === "other" ? (biz.pm_surya_ghar_other || "Other") : cap(biz.pm_surya_ghar)}
                </Pill>
              )}
              <Pill tint="amber">
                {biz.status === "under_review" ? "Under review" :
                 biz.status === "approved"     ? "Approved" :
                 biz.status === "on_hold"      ? "On hold" :
                 biz.status === "rejected"     ? "Rejected" : "Draft"}
              </Pill>
            </div>
          </div>
        </div>

        {/* ── INTERNAL STATUS BAND — admin-only, visually distinct ──── */}
        {/* Slate palette (not brand green) so it can't be confused with     */}
        {/* the lender "Approved" tick, which is what actually unlocks the   */}
        {/* EPC's loan application. This field is purely internal admin      */}
        {/* tracking; the EPC never sees it and it never gates their access. */}
        <InternalStatusBand
          current={biz.status}
          busy={statusBusy}
          onChange={changeStatus}
        />

        {/* ── PROGRESS TRACKER — prominent standalone band ─────────── */}
        <div className="rounded-[12px] border border-[#cdeadd] bg-white p-6 sm:p-8 mb-4">
          <div className="flex items-center gap-3 sm:gap-6">
            <BigProgressStep
              icon={I.check}
              done={biz.status !== "draft"}
              label="Docs uploaded"
              sub={biz.status !== "draft" ? "Complete" : "Pending"}
            />
            <BigConnector active={biz.status !== "draft"} />
            <BigProgressStep
              icon={I.send}
              done={docsGivenCount === 3}
              inProgress={docsGivenCount > 0 && docsGivenCount < 3}
              label="Sent to lenders"
              sub={`${docsGivenCount}/3 sent`}
            />
            <BigConnector active={docsGivenCount > 0} />
            <BigProgressStep
              icon={I.circleCheck}
              done={anyApproved}
              label={anyApproved ? "Approved" : "Approval pending"}
              sub={anyApproved ? "Loan-app unlocked" : "Awaiting a lender"}
              mutedIfPending
            />
          </div>
        </div>

        {/* ── 3-COLUMN GRID ──────────────────────────────────────────── */}
        <div className="grid gap-4 lg:grid-cols-3">

          {/* COL 1 */}
          <div className="flex flex-col gap-2.5">
            <SectionCard title="Contact & business" accent="blue" icon={I.user}>
              <KV k="POC" v={biz.contact_name} />
              <KV k="Mobile" v={biz.contact_mobile ? `+91 ${biz.contact_mobile}` : "—"} />
              <KV k="Email" v={biz.contact_email} valueClass="text-[#185fa5]" />
              <KV k="PAN" v={biz.pan_number} />
              <KV k="PM Surya Ghar" v={
                biz.pm_surya_ghar === "other"
                  ? `Other · ${biz.pm_surya_ghar_other || "—"}`
                  : biz.pm_surya_ghar ? cap(biz.pm_surya_ghar) : "—"
              } />
            </SectionCard>

            <SectionCard title={peopleHeading(biz.business_type)} accent="green" icon={I.users}>
              {stakeholders.length === 0 ? (
                <p className="text-[13px] text-[#5a8a76]">No members recorded.</p>
              ) : (
                <div className="space-y-2">
                  {stakeholders.map((s, i) => (
                    <div key={s.id ?? i} className="px-3 py-2.5 bg-[#f0faf5] rounded-[8px] text-[14px]">
                      <div className="font-semibold text-[#0f3d2e]">{s.name || "—"}</div>
                      <div className="text-[13px] text-[#5a8a76] mt-0.5">
                        {s.designation || roleLabel(biz.business_type)}
                        {s.mobile ? ` · +91 ${s.mobile}` : ""}
                      </div>
                      {s.email && <div className="text-[#185fa5] text-[12px] mt-0.5 truncate">{s.email}</div>}
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard title="Bank" accent="blue" icon={I.bank}>
              <KV k="Account" v={maskAcct(biz.bank_account_number)} />
              <KV k="IFSC" v={biz.bank_ifsc} />
              <KV k="Bank" v={biz.bank_name} />
            </SectionCard>
          </div>

          {/* COL 2 */}
          <div className="flex flex-col gap-2.5">
            <SectionCard
              title={`Documents (${nonR3bDocs.length})`}
              accent="green"
              icon={I.files}
            >
              {nonR3bDocs.length === 0 ? (
                <p className="text-[13px] text-[#5a8a76]">No documents uploaded.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {nonR3bDocs.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => openDoc(d.id)}
                      className="border border-[#e0f0e8] bg-[#f7fcfa] hover:bg-[#f0faf5] rounded-[8px] px-3 py-2.5 text-[13px] flex items-center justify-between gap-2 min-w-0"
                    >
                      <span className="text-[#0f3d2e] font-medium truncate">{DOC_LABEL(d.category)}</span>
                      <span className="text-[#185fa5] shrink-0" style={{ transform: "scale(1.2)" }}>{I.eye}</span>
                    </button>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard title="References" accent="green" icon={I.star}>
              {refs.length === 0 ? (
                <p className="text-[13px] text-[#5a8a76]">No references.</p>
              ) : (
                <>
                  {customers.length > 0 && (
                    <>
                      <div className="text-[12px] font-semibold text-[#5a8a76] uppercase tracking-wide mt-0.5">Customers</div>
                      <div className="text-[14px] text-[#0f3d2e] mb-2 mt-1 leading-snug">
                        {customers.map((c) => c.name).join(" · ") || "—"}
                      </div>
                    </>
                  )}
                  {suppliers.length > 0 && (
                    <>
                      <div className="text-[12px] font-semibold text-[#5a8a76] uppercase tracking-wide">Suppliers</div>
                      <div className="text-[14px] text-[#0f3d2e] mt-1 leading-snug">
                        {suppliers.map((s) => s.name).join(" · ") || "—"}
                      </div>
                    </>
                  )}
                </>
              )}
            </SectionCard>
          </div>

          {/* COL 3 — admin only */}
          <div className="flex flex-col gap-2.5">
            <SectionCard title="Business info" tint icon={I.lock} adminOnly>
              <KV k="Team size" v={adminInfo?.team_size} />
              <KV k="Resi cap." v={fmtCapacity(adminInfo?.capacity_residential, adminInfo?.capacity_residential_unit)} />
              <KV k="Comm cap." v={fmtCapacity(adminInfo?.capacity_commercial, adminInfo?.capacity_commercial_unit)} />
              <KV k="Turnover" v={adminInfo?.turnover_last_fy} />
            </SectionCard>

            <SectionCard title="Lenders" tint icon={I.money} adminOnly>
              {(["creditfair", "aerem", "solfin"] as const).map((key) => {
                const l = lender.find((x) => x.lender === key);
                const label = key === "creditfair" ? "CreditFair" : key === "aerem" ? "Aerem" : "Solfin";
                const state = l ? (l.approved ? "approved" : l.docs_given ? "docs" : "none") : "none";
                return (
                  <div key={key} className="flex items-center justify-between text-[14px] py-1">
                    <span className="text-[#0f3d2e] font-medium">{label}</span>
                    <LenderStatePill state={state} />
                  </div>
                );
              })}
            </SectionCard>

            <SectionCard title="GST R3B" tint icon={I.invoice} adminOnly>
              <div className="text-[12px] text-[#5a8a76]">
                {r3bDocs.length} file{r3bDocs.length === 1 ? "" : "s"} · Grand total taxable
              </div>
              <div className="text-[20px] font-semibold text-[#0f3d2e] mt-1">
                ₹{r3bTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </div>
              <button
                type="button"
                onClick={() => router.push(`/admin/epc/${biz.id}` as any)}
                className="w-full mt-3 text-[13px] font-medium py-2 px-3 bg-white border border-[#cdeadd] rounded-[8px] text-[#178a5c] hover:bg-[#f0faf5] inline-flex items-center justify-center gap-1.5"
              >
                {I.eye} View R3B
              </button>
            </SectionCard>
          </div>
        </div>

        {/* ── Actions ────────────────────────────────────────────────── */}
        <div className="flex gap-3 mt-4">
          <button
            type="button"
            onClick={() => router.push(`/admin/epc/${biz.id}` as any)}
            className="flex-1 py-3.5 text-[15px] font-semibold bg-[#178a5c] text-white rounded-[10px] hover:bg-[#12734c] inline-flex items-center justify-center gap-2"
          >
            {I.edit} Edit profile
          </button>
          <button
            type="button"
            onClick={downloadZip}
            disabled={downloading}
            className="flex-1 py-3.5 text-[15px] font-semibold bg-[#185fa5] text-white rounded-[10px] hover:bg-[#144d84] disabled:opacity-70 inline-flex items-center justify-center gap-2"
          >
            {I.download} {downloading ? "Preparing…" : "Download ZIP"}
          </button>
        </div>

      </div>
    </main>
  );
}

// ── Reusable pieces ─────────────────────────────────────────────────

const INTERNAL_STATUS_LABEL: Record<string, string> = {
  draft:        "Draft",
  under_review: "Under review",
  approved:     "Approved",
  on_hold:      "On hold",
  rejected:     "Rejected",
};

function InternalStatusBand({
  current, busy, onChange,
}: {
  current: string;
  busy: boolean;
  onChange: (next: "approved" | "on_hold" | "rejected" | "under_review") => void;
}) {
  // Draft: nothing to change yet (EPC hasn't submitted).
  const label = INTERNAL_STATUS_LABEL[current] ?? current;
  return (
    <div className="rounded-[12px] border border-slate-300 bg-slate-50 p-4 sm:p-5 mb-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
            Internal status <span className="normal-case font-normal text-slate-400">· admin only</span>
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[18px] font-semibold text-slate-800">{label}</span>
            <span className="text-[12px] text-slate-500">
              Private to admin — does not unlock the EPC&rsquo;s loan application.
              Only a lender &ldquo;Approved&rdquo; tick does.
            </span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {current === "draft" && (
            <span className="text-[12px] text-slate-500 italic self-center">
              EPC hasn&rsquo;t submitted yet
            </span>
          )}
          {current === "under_review" && (
            <>
              <StatusBtn kind="approve" busy={busy} onClick={() => onChange("approved")}>Approve</StatusBtn>
              <StatusBtn kind="neutral" busy={busy} onClick={() => onChange("on_hold")}>On hold</StatusBtn>
              <StatusBtn kind="danger" busy={busy} onClick={() => onChange("rejected")}>Reject</StatusBtn>
            </>
          )}
          {current === "on_hold" && (
            <>
              <StatusBtn kind="approve" busy={busy} onClick={() => onChange("approved")}>Approve</StatusBtn>
              <StatusBtn kind="neutral" busy={busy} onClick={() => onChange("under_review")}>Back to review</StatusBtn>
              <StatusBtn kind="danger" busy={busy} onClick={() => onChange("rejected")}>Reject</StatusBtn>
            </>
          )}
          {current === "rejected" && (
            <StatusBtn kind="neutral" busy={busy} onClick={() => onChange("under_review")}>Re-open</StatusBtn>
          )}
          {current === "approved" && (
            <StatusBtn kind="neutral" busy={busy} onClick={() => onChange("under_review")}>Move back to review</StatusBtn>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBtn({
  kind, busy, onClick, children,
}: {
  kind: "approve" | "neutral" | "danger";
  busy: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const base = "text-[13px] font-semibold px-3.5 py-1.5 rounded-md border transition-colors disabled:opacity-60";
  const cls =
    kind === "approve" ? "bg-slate-800 text-white border-slate-800 hover:bg-slate-700" :
    kind === "danger"  ? "bg-white text-red-700 border-red-300 hover:bg-red-50" :
                         "bg-white text-slate-700 border-slate-300 hover:bg-slate-100";
  return (
    <button type="button" disabled={busy} onClick={onClick} className={[base, cls].join(" ")}>
      {children}
    </button>
  );
}

function Pill({ children, tint, icon }: {
  children: React.ReactNode;
  tint: "blue" | "amber";
  icon?: React.ReactNode;
}) {
  const cls = tint === "amber"
    ? "bg-[#fef0d6] text-[#854f0b] font-semibold"
    : "bg-[#dceffb] text-[#185fa5] font-medium";
  return (
    <span className={["inline-flex items-center gap-1.5 text-[13px] px-3 py-1.5 rounded-[8px]", cls].join(" ")}>
      {icon && <span className="opacity-90">{icon}</span>}
      {children}
    </span>
  );
}

function BigProgressStep({ icon, done, inProgress, label, sub, mutedIfPending }: {
  icon: React.ReactNode;
  done?: boolean;
  inProgress?: boolean;
  label: React.ReactNode;
  sub?: React.ReactNode;
  mutedIfPending?: boolean;
}) {
  const bg = done
    ? "bg-[#178a5c] text-white ring-4 ring-[#178a5c]/15"
    : inProgress
    ? "bg-[#ef9f27] text-white ring-4 ring-[#ef9f27]/15"
    : "bg-[#e3eeff] text-[#6b93c4]";
  const labelCls = done || inProgress
    ? "text-[#0f3d2e] font-semibold"
    : (mutedIfPending ? "text-[#5a8a76] font-medium" : "text-[#0f3d2e] font-semibold");
  const subCls = done || inProgress ? "text-[#5a8a76]" : "text-[#8ab3a1]";
  return (
    <div className="flex-1 flex flex-col items-center gap-3 min-w-0">
      <div className={["w-[56px] h-[56px] rounded-full grid place-items-center shrink-0 transition-all", bg].join(" ")} style={{ transform: "scale(1.35)" }}>
        <span style={{ transform: "scale(1.5)" }}>{icon}</span>
      </div>
      <div className="text-center min-w-0">
        <div className={["text-[15px] leading-tight", labelCls].join(" ")}>{label}</div>
        {sub && <div className={["text-[12px] mt-1", subCls].join(" ")}>{sub}</div>}
      </div>
    </div>
  );
}

function BigConnector({ active }: { active: boolean }) {
  return (
    <div
      className={["flex-none h-[4px] rounded-full", active ? "bg-[#9dcbe8]" : "bg-[#e3eeff]"].join(" ")}
      style={{ width: "clamp(40px, 8vw, 120px)" }}
    />
  );
}

function SectionCard({
  title, icon, children, accent, tint, adminOnly,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  accent?: "blue" | "green";
  tint?: boolean;
  adminOnly?: boolean;
}) {
  const borderCls =
    accent === "blue" ? "border-[#d3e9f7]" :
    accent === "green" ? "border-[#cdeadd]" :
    "border-[#cdeadd]";
  const bgCls = tint ? "bg-[#f0faf5]" : "bg-white";
  const titleCls = accent === "blue" ? "text-[#185fa5]" : "text-[#178a5c]";
  return (
    <div className={["rounded-[12px] border p-5", borderCls, bgCls].join(" ")}>
      <div className={["text-[14px] font-semibold mb-3 flex items-center gap-2", titleCls].join(" ")}>
        <span style={{ transform: "scale(1.2)", transformOrigin: "left center", display: "inline-flex" }}>{icon}</span>
        <span>{title}</span>
        {adminOnly && <span className="ml-1.5 text-[11px] text-[#8ab3a1] font-normal">admin</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function KV({ k, v, valueClass }: { k: string; v: unknown; valueClass?: string }) {
  const display = v === null || v === undefined || v === "" ? "—" : String(v);
  return (
    <div className="flex justify-between text-[14px] py-[5px] gap-3">
      <span className="text-[#5a8a76] shrink-0">{k}</span>
      <span className={["text-right min-w-0 truncate font-medium", valueClass ?? "text-[#0f3d2e]"].join(" ")}>{display}</span>
    </div>
  );
}

function LenderStatePill({ state }: { state: "approved" | "docs" | "none" }) {
  if (state === "approved") {
    return <span className="text-[13px] text-[#178a5c] font-semibold inline-flex items-center gap-1.5">
      <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#178a5c]" /> approved
    </span>;
  }
  if (state === "docs") {
    return <span className="text-[13px] text-[#854f0b] font-medium inline-flex items-center gap-1.5">
      <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#ef9f27]" /> docs sent
    </span>;
  }
  return <span className="text-[13px] text-[#8ab3a1]">not sent</span>;
}

function fmtCapacity(n: number | null | undefined, unit: string | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${n} ${unit ?? ""}`.trim();
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
