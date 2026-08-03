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
import LenderPickerModal, { LenderKey } from "@/components/LenderPickerModal";
import CommentsSection from "@/components/CommentsSection";
import ActivityLogModal from "@/components/ActivityLogModal";
import DeleteEpcModal from "@/components/DeleteEpcModal";
// Shared view chrome — the SAME kit the Loan Application View imports, so the
// two dashboards can't drift apart. EPC-specific pieces stay in this file.
import {
  I, StatusBtn, Pill, BigProgressStep, BigConnector, SectionCard, KV,
  StepBlock, DocGrid, type ViewDocSlot,
} from "@/components/view/ViewKit";

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
type LenderRow = { lender: string; docs_given: boolean; approved: boolean; rejected?: boolean };
type AdminInfo = {
  team_size: string | null;
  team_technical: number | null;
  team_non_technical: number | null;
  capacity_residential: number | null;
  capacity_residential_unit: "KW" | "MW" | null;
  capacity_commercial: number | null;
  capacity_commercial_unit: "KW" | "MW" | null;
  turnover_last_fy: string | null;
  turnover_lakhs: number | null;
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
    default:               return "Stakeholder details";
  }
}

function roleLabel(bt: string | null | undefined): string {
  switch (bt) {
    case "proprietorship": return "Proprietor";
    case "pvt_ltd":        return "Director";
    case "partnership":
    case "llp":            return "Partner";
    default:               return "Stakeholder";
  }
}

function DOC_LABEL(cat: string): string {
  const M: Record<string, string> = {
    pan_business: "PAN card",
    gstin: "GST reg.",
    extra_doc: "Extra doc",
    admin_extra: "Extra document",
    cancelled_cheque: "Cheque",
    stakeholder_pan: "Member PAN",
    stakeholder_aadhaar: "Aadhaar (legacy)",
    stakeholder_aadhaar_front: "Aadhaar F",
    stakeholder_aadhaar_back: "Aadhaar B",
    office_exterior: "Office ext",
    office_interior: "Office int",
    office_selfie: "Selfie",
    gst_r3b: "GSTR-3B",
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

function Inner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [biz, setBiz] = useState<Biz | null>(null);
  const [loans, setLoans] = useState<{ status: string; plant_use_type: string | null; loan_display_id: string | null; sanctioned_amount: number | null; first_disbursement_amount: number | null; second_disbursement_amount: number | null }[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [lender, setLender] = useState<LenderRow[]>([]);
  const [adminInfo, setAdminInfo] = useState<AdminInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [serviceBusy, setServiceBusy] = useState(false);
  const [zipPickerOpen, setZipPickerOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Bumped after any comment write to force ActivityLog to re-fetch.
  const [activityRefresh, setActivityRefresh] = useState(0);

  useEffect(() => {
    void (async () => {
      const [{ data: b }, { data: d }, { data: l }, { data: ai }, { data: la }] = await Promise.all([
        supabase().from("epc_business").select("*").eq("id", params.id).maybeSingle(),
        supabase().from("epc_documents").select("id, category, file_name, mime_type, stakeholder_id, metadata").eq("business_id", params.id),
        supabase().from("epc_lender_status").select("lender, docs_given, approved, rejected").eq("business_id", params.id),
        supabase().from("epc_admin_info").select("*").eq("business_id", params.id).maybeSingle(),
        supabase().from("epc_applications").select("status, plant_use_type, loan_display_id, sanctioned_amount, first_disbursement_amount, second_disbursement_amount").eq("epc_business_id", params.id),
      ]);
      setBiz(b);
      setDocs((d ?? []) as Doc[]);
      setLender((l ?? []) as LenderRow[]);
      setAdminInfo((ai as AdminInfo | null) ?? null);
      setLoans((la ?? []) as typeof loans);
    })();
  }, [params.id, activityRefresh]);

  // Bumped whenever the inline CommentsSection writes something — so the
  // Activity log modal (which reads from admin_edit_log) reflects the
  // new comment event next time the admin opens it.
  function onCommentsChanged() {
    setActivityRefresh((n) => n + 1);
  }

  const r3bDocs = useMemo(() => docs.filter((d) => d.category === "gst_r3b"), [docs]);

  // EPC Health — all-time aggregate of THIS EPC's own loan applications,
  // split Residential / C&I via the CC-RES / CC-COM display-id prefix.
  const loanAgg = useMemo(() => {
    type LR = (typeof loans)[number];
    const isRes = (r: LR) => (r.loan_display_id || "").toUpperCase().startsWith("CC-RES") || r.plant_use_type === "residential";
    const isCom = (r: LR) => (r.loan_display_id || "").toUpperCase().startsWith("CC-COM") || r.plant_use_type === "commercial";
    const bucket = (rows: LR[]) => {
      const submitted  = rows.filter((r) => r.status !== "draft").length;
      const rejected   = rows.filter((r) => r.status === "rejected").length;
      const sanctioned = rows.reduce((s, r) => s + (Number(r.sanctioned_amount) || 0), 0);
      const disbursed  = rows.reduce((s, r) => s + (Number(r.first_disbursement_amount) || 0) + (Number(r.second_disbursement_amount) || 0), 0);
      return { submitted, rejected, sanctioned, disbursed, pending: Math.max(0, sanctioned - disbursed) };
    };
    return { res: bucket(loans.filter(isRes)), com: bucket(loans.filter(isCom)), total: bucket(loans) };
  }, [loans]);
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
      // reviewed_at = the first time an admin acted on this EPC after
      // it was submitted. First-write wins — subsequent status flips
      // keep the original timestamp so the analytics "time to review"
      // metric measures initial admin response, not the latest change.
      const patch: Record<string, unknown> = { status: next };
      const firstReview = !biz.reviewed_at ? new Date().toISOString() : null;
      if (firstReview) patch.reviewed_at = firstReview;

      const { error } = await supabase()
        .from("epc_business")
        .update(patch)
        .eq("id", biz.id);
      if (error) {
        alert("Status update failed: " + error.message);
        return;
      }
      await logAudit(biz.id, "field_edit", "status", biz.status, next);
      setBiz({ ...biz, status: next, ...(firstReview ? { reviewed_at: firstReview } : {}) });
    } finally {
      setStatusBusy(false);
    }
  }

  // Admin picks the EPC's service. Insurance unlocks purely from this;
  // loan still additionally needs a lender "Approved" tick.
  async function setService(next: "loans" | "insurance" | "both") {
    if (!biz || serviceBusy) return;
    setServiceBusy(true);
    try {
      const { error } = await supabase()
        .from("epc_business")
        .update({ service_type: next })
        .eq("id", biz.id);
      if (error) { alert("Service update failed: " + error.message); return; }
      await logAudit(biz.id, "field_edit", "service_type", biz.service_type ?? null, next);
      setBiz({ ...biz, service_type: next });
    } finally {
      setServiceBusy(false);
    }
  }

  async function downloadZip(lender: LenderKey) {
    if (!biz || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/epc/${biz.id}/download-zip?lender=${lender}`, {
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
        {/* Internal status + Service side by side (stacks on narrow). */}
        <div className={biz.status === "approved" ? "grid gap-4 lg:grid-cols-2" : ""}>
          <InternalStatusBand
            current={biz.status}
            busy={statusBusy}
            onChange={changeStatus}
          />

          {/* ── SERVICE — only when internally Approved. Governs which portal
              buttons the EPC sees (insurance needs no lender approval). ── */}
          {biz.status === "approved" && (
            <ServiceBand
              current={biz.service_type ?? null}
              busy={serviceBusy}
              onChange={setService}
            />
          )}
        </div>

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

        {/* ── EPC HEALTH — all-time aggregate; only once internally approved ─ */}
        {biz.status === "approved" && (
        <div className="rounded-[12px] border border-[#cdeadd] bg-white p-5 sm:p-6 mb-4">
          <div className="text-[11px] font-semibold text-[#5a8a76] uppercase tracking-wider mb-3">
            EPC Health <span className="normal-case font-normal text-slate-400">· admin only · all-time · amounts in ₹ Lacs</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-[11px] uppercase tracking-wide text-[#5a8a76] border-b border-[#cdeadd]">
                <tr>
                  <th className="text-left py-2 pr-3 font-medium">Metric</th>
                  <th className="text-right py-2 px-3 font-medium">Residential</th>
                  <th className="text-right py-2 px-3 font-medium">C&amp;I</th>
                  <th className="text-right py-2 pl-3 font-medium text-[#0f3d2e]">Total</th>
                </tr>
              </thead>
              <tbody>
                {([
                  { label: "Applications Submitted", k: "submitted" as const, money: false },
                  { label: "Rejected",               k: "rejected" as const,  money: false },
                  { label: "Sanctioned Amount",      k: "sanctioned" as const, money: true },
                  { label: "Disbursed",              k: "disbursed" as const,  money: true },
                  { label: "Pending Disbursal",      k: "pending" as const,    money: true },
                ]).map((row) => {
                  const cell = (v: number) => row.money
                    ? `₹${(v / 100000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} L`
                    : v.toLocaleString("en-IN");
                  return (
                    <tr key={row.k} className="border-b border-[#eef1f4] last:border-0">
                      <td className="py-2 pr-3 text-[#5a8a76]">{row.label}</td>
                      <td className="py-2 px-3 text-right text-[#0f3d2e]">{cell(loanAgg.res[row.k])}</td>
                      <td className="py-2 px-3 text-right text-[#0f3d2e]">{cell(loanAgg.com[row.k])}</td>
                      <td className="py-2 pl-3 text-right font-semibold text-[#0f3d2e]">{cell(loanAgg.total[row.k])}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        )}

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
              {biz.pm_surya_ghar === "yes" && (
                <KV k="Surya Ghar installs" v={biz.pm_surya_ghar_capacity} />
              )}
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
                <DocumentsBySteps
                  docs={nonR3bDocs}
                  stakeholders={stakeholders}
                  businessType={biz.business_type as string | null}
                  openDoc={openDoc}
                  eyeIcon={I.eye}
                />
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
            {/* Col 3 order: Business info → Lenders → GST R3B → Comments. */}

            <SectionCard title="Business info" tint icon={I.lock} adminOnly>
              <KV k="Team size" v={fmtTeam(adminInfo)} />
              <KV k="Resi cap." v={fmtCapacity(adminInfo?.capacity_residential, adminInfo?.capacity_residential_unit)} />
              <KV k="Comm cap." v={fmtCapacity(adminInfo?.capacity_commercial, adminInfo?.capacity_commercial_unit)} />
              <KV k="Turnover" v={fmtTurnover(adminInfo)} />
              <KV k="Expectation" v={
                biz.business_expectation_value != null
                  ? `${biz.business_expectation_value}${biz.business_expectation ? " " + cap(biz.business_expectation) : ""}`
                  : (biz.business_expectation ? cap(biz.business_expectation) : "—")
              } />
            </SectionCard>

            <SectionCard title="Lenders" tint icon={I.money} adminOnly>
              {(["creditfair", "aerem", "solfin"] as const).map((key) => {
                const l = lender.find((x) => x.lender === key);
                const label = key === "creditfair" ? "CreditFair" : key === "aerem" ? "Aerem" : "Solfin";
                const state = l
                  ? ((l as any).rejected ? "rejected" : l.approved ? "approved" : l.docs_given ? "docs" : "none")
                  : "none";
                return (
                  <div key={key} className="flex items-center justify-between text-[14px] py-1">
                    <span className="text-[#0f3d2e] font-medium">{label}</span>
                    <LenderStatePill state={state} />
                  </div>
                );
              })}
            </SectionCard>

            <SectionCard title="GSTR-3B" tint icon={I.invoice} adminOnly>
              <div className="text-[12px] text-[#5a8a76]">
                {r3bDocs.length} file{r3bDocs.length === 1 ? "" : "s"} · Grand total taxable
              </div>
              <div className="text-[20px] font-semibold text-[#0f3d2e] mt-1">
                ₹{r3bTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </div>
              <button
                type="button"
                onClick={() => router.push(`/admin/epc/${biz.id}` as any)}
                title="View GSTR-3B"
                aria-label="View GSTR-3B"
                className="mt-3 w-8 h-8 grid place-items-center rounded-md border border-[#cdeadd] bg-white text-[#178a5c] hover:bg-[#f0faf5]"
              >
                {I.eye}
              </button>
            </SectionCard>

            {/* Inline chat-box comments — LAST in Col 3 per spec. */}
            <SectionCard title="Comments" tint icon={I.lock} adminOnly>
              <CommentsSection
                businessId={biz.id}
                epcName={trade}
                onChanged={onCommentsChanged}
                maxListHeight={360}
              />
            </SectionCard>
          </div>
        </div>

        {/* ── Actions strip — Activity log · Edit profile · Download ZIP */}
        <div className="flex gap-3 mt-4">
          <button
            type="button"
            onClick={() => setActivityOpen(true)}
            className="flex-1 py-3.5 text-[15px] font-semibold bg-white border-2 border-[#178a5c] text-[#178a5c] rounded-[10px] hover:bg-[#f0faf5] inline-flex items-center justify-center gap-2"
          >
            {I.eye} Activity log
          </button>
          <button
            type="button"
            onClick={() => router.push(`/admin/epc/${biz.id}` as any)}
            className="flex-1 py-3.5 text-[15px] font-semibold bg-[#178a5c] text-white rounded-[10px] hover:bg-[#12734c] inline-flex items-center justify-center gap-2"
          >
            {I.edit} Edit profile
          </button>
          <button
            type="button"
            onClick={() => setZipPickerOpen(true)}
            disabled={downloading}
            className="flex-1 py-3.5 text-[15px] font-semibold bg-[#185fa5] text-white rounded-[10px] hover:bg-[#144d84] disabled:opacity-70 inline-flex items-center justify-center gap-2"
          >
            {I.download} {downloading ? "Preparing…" : "Download ZIP"}
          </button>
        </div>

        {/* Danger zone — Delete profile. Hidden entirely for admin
            rows (defense layer 1: the button never renders). Backend
            still enforces the ban even if this check is bypassed. */}
        {biz.business_type !== "admin" && (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="px-4 py-2 text-[13px] font-semibold border border-red-300 text-red-700 rounded-[8px] hover:bg-red-50 hover:border-red-500 transition-colors"
            >
              Delete profile
            </button>
          </div>
        )}

      </div>

      <LenderPickerModal
        open={zipPickerOpen}
        onClose={() => setZipPickerOpen(false)}
        epcName={trade}
        onConfirm={(lender) => downloadZip(lender)}
      />
      <ActivityLogModal
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        businessId={biz.id}
        epcName={trade}
        refreshKey={activityRefresh}
      />
      <DeleteEpcModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDeleted={(payload) => {
          setDeleteOpen(false);
          alert(`Deleted ${payload.display_id ?? "EPC"}${payload.contact_name ? ` — ${payload.contact_name}` : ""}.`);
          router.push("/admin");
        }}
        businessId={biz.id}
        displayId={biz.epc_display_id ?? null}
        contactName={biz.contact_name ?? null}
        contactMobile={biz.contact_mobile ?? null}
      />
    </main>
  );
}

// ── Reusable pieces ─────────────────────────────────────────────────

// Service band — same shape as the internal-status band, but green (brand)
// since this is a positive, EPC-affecting choice. Sets epc_business.service_type.
const SERVICE_LABEL: Record<string, string> = {
  loans:     "Service provided: Loan",
  insurance: "Service provided: Insurance",
  both:      "Service provided: Both loan and insurance",
};

function ServiceBand({
  current, busy, onChange,
}: {
  current: "loans" | "insurance" | "both" | null;
  busy: boolean;
  onChange: (next: "loans" | "insurance" | "both") => void;
}) {
  const badge = current ? SERVICE_LABEL[current] : null;
  const btn = (val: "loans" | "insurance" | "both", label: string) => {
    const active = current === val;
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => onChange(val)}
        className={[
          "text-[13px] font-semibold px-3.5 py-1.5 rounded-md border transition-colors disabled:opacity-60",
          active
            ? "bg-[#178a5c] text-white border-[#178a5c]"
            : "bg-white text-[#178a5c] border-[#cdeadd] hover:bg-[#f0faf5]",
        ].join(" ")}
      >
        {label}
      </button>
    );
  };
  return (
    <div className="rounded-[12px] border border-[#cdeadd] bg-[#f0faf5] p-4 sm:p-5 mb-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-[#5a8a76] uppercase tracking-wider mb-1">
            Service <span className="normal-case font-normal text-[#8ab3a1]">· admin only</span>
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[18px] font-semibold text-[#0f3d2e]">{badge ?? "Not set"}</span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {btn("loans", "Only Loans")}
          {btn("insurance", "Only Insurance")}
          {btn("both", "Loan and Insurance")}
        </div>
      </div>
    </div>
  );
}

const INTERNAL_STATUS_LABEL: Record<string, string> = {
  draft:        "Draft",
  under_review: "Under review",
  approved:     "Approved by Capital Craft",
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
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {/* Draft: admin can still act — internal status is admin's
              bookkeeping, not gated on EPC submission. Show the same
              action buttons as under_review, plus a small hint. */}
          {current === "draft" && (
            <>
              <span className="text-[12px] text-slate-500 italic self-center">
                EPC hasn&rsquo;t submitted yet
              </span>
              <StatusBtn kind="approve" busy={busy} onClick={() => onChange("approved")}>Approve</StatusBtn>
              <StatusBtn kind="neutral" busy={busy} onClick={() => onChange("on_hold")}>On hold</StatusBtn>
              <StatusBtn kind="danger" busy={busy} onClick={() => onChange("rejected")}>Reject</StatusBtn>
              <StatusBtn kind="neutral" busy={busy} onClick={() => onChange("under_review")}>Mark under review</StatusBtn>
            </>
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

function LenderStatePill({ state }: { state: "approved" | "docs" | "none" | "rejected" }) {
  if (state === "rejected") {
    return <span className="text-[13px] text-[#dc2626] font-semibold inline-flex items-center gap-1.5">
      <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#dc2626]" /> rejected
    </span>;
  }
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
  const u = unit === "KW" ? "kW" : unit === "MW" ? "MW" : (unit ?? "");
  return `${n} ${u}`.trim();
}

// Team size: prefer the split Technical/Non-Technical counts; fall back to
// the legacy combined free-text value for historical rows.
function fmtTeam(ai: AdminInfo | null): string | null {
  if (!ai) return null;
  if (ai.team_technical != null || ai.team_non_technical != null) {
    const t = ai.team_technical != null ? String(ai.team_technical) : "—";
    const nt = ai.team_non_technical != null ? String(ai.team_non_technical) : "—";
    return `${t} tech · ${nt} non-tech`;
  }
  return ai.team_size ?? null;
}

// Turnover: prefer the numeric ₹ Lakhs value; fall back to the legacy
// free-text value for historical rows.
function fmtTurnover(ai: AdminInfo | null): string | null {
  if (!ai) return null;
  if (ai.turnover_lakhs != null) return `₹${ai.turnover_lakhs} Lakhs`;
  return ai.turnover_last_fy ?? null;
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ── DocumentsBySteps ─────────────────────────────────────────────────
//
// Renders the EPC's documents grouped by the onboarding step that
// produced them, in step order. Sections with zero docs are hidden so
// the panel stays compact. Stakeholder docs are further grouped per
// stakeholder with role-based labels (Proprietor / Director N / Partner
// N / Stakeholder N) that fall back to "Stakeholder N" when
// business_type is null.
//
// Signed-URL viewing (openDoc) is unchanged.

const BUSINESS_STEP_CATS = ["pan_business", "gstin", "extra_doc"] as const;
const STAKEHOLDER_CATS = [
  "stakeholder_pan",
  "stakeholder_aadhaar_front",
  "stakeholder_aadhaar_back",
  "stakeholder_aadhaar",
] as const;
const BANK_CATS   = ["cancelled_cheque"] as const;
const OFFICE_CATS = ["office_exterior", "office_interior", "office_selfie"] as const;

type DocSlot = { key: string; label: string; doc: Doc | null };

// Build the slot list for a doc family: one slot per expected category
// (present → eye-View, absent → greyed "Not uploaded"), followed by any
// extra uploaded docs that don't map to an expected slot so nothing is
// hidden.
function buildSlots(
  familyDocs: Doc[],
  expectedCats: string[],
  labelFn: (cat: string) => string,
): DocSlot[] {
  const used = new Set<string>();
  const slots: DocSlot[] = expectedCats.map((cat, i) => {
    const doc = familyDocs.find((d) => d.category === cat && !used.has(d.id)) ?? null;
    if (doc) used.add(doc.id);
    return { key: `${cat}-${i}`, label: labelFn(cat), doc };
  });
  familyDocs
    .filter((d) => !used.has(d.id))
    .forEach((d) => slots.push({ key: `x-${d.id}`, label: labelFn(d.category), doc: d }));
  return slots;
}

function DocumentsBySteps({
  docs, stakeholders, businessType, openDoc, eyeIcon,
}: {
  docs: Doc[];
  stakeholders: Array<{ id: string; name?: string; designation?: string; mobile?: string; email?: string }>;
  businessType: string | null;
  openDoc: (id: string) => void;
  eyeIcon: React.ReactNode;
}) {
  // Bucket docs by category family.
  const byCat = (cats: readonly string[]) =>
    docs.filter((d) => cats.includes(d.category));

  const bizDocs    = byCat(BUSINESS_STEP_CATS);
  const stkDocs    = byCat(STAKEHOLDER_CATS);
  const bankDocs   = byCat(BANK_CATS);
  const officeDocs = byCat(OFFICE_CATS);
  const knownCats: readonly string[] =
    [...BUSINESS_STEP_CATS, ...STAKEHOLDER_CATS, ...BANK_CATS, ...OFFICE_CATS];
  const otherDocs  = docs.filter((d) => !knownCats.includes(d.category));

  const stakeholderIndex = new Map<string, number>();
  stakeholders.forEach((s, i) => stakeholderIndex.set(s.id, i));

  // Group stakeholder docs by stakeholder_id, preserving stakeholder order.
  const stakeholderGroups = stakeholders.map((s) => ({
    stakeholder: s,
    docs: stkDocs.filter((d) => d.stakeholder_id === s.id),
  }));
  // Orphan stakeholder docs (stakeholder_id that doesn't match any current row).
  const orphanStakeholderDocs = stkDocs.filter(
    (d) => !d.stakeholder_id || !stakeholderIndex.has(d.stakeholder_id),
  );

  // Expected document sets — missing ones render greyed as "Not uploaded".
  const hasExtraDoc =
    businessType === "partnership" || businessType === "pvt_ltd" || businessType === "llp";
  const bizExpected = hasExtraDoc
    ? ["pan_business", "gstin", "extra_doc"]
    : ["pan_business", "gstin"];
  const bizSlots    = buildSlots(bizDocs, bizExpected, (c) => businessDocLabel(c, businessType));
  const bankSlots   = buildSlots(bankDocs, ["cancelled_cheque"], () => "Empty cheque copy / picture");
  const officeSlots = buildSlots(
    officeDocs,
    ["office_exterior", "office_interior", "office_selfie"],
    (c) => officeDocLabel(c, businessType),
  );
  const STK_EXPECTED = ["stakeholder_pan", "stakeholder_aadhaar_front", "stakeholder_aadhaar_back"];

  return (
    <div className="space-y-4">
      <StepBlock title="Business (Step 2)">
        <DocGrid slots={toViewSlots(bizSlots, openDoc)} eyeIcon={eyeIcon} />
      </StepBlock>

      {(stakeholderGroups.length > 0 || orphanStakeholderDocs.length > 0) && (
        <StepBlock title="Stakeholders (Step 3)">
          <div className="space-y-2.5">
            {stakeholderGroups.map((g, i) => (
              <StakeholderDocs
                key={g.stakeholder.id ?? i}
                header={stakeholderRoleTag(businessType, i, stakeholders.length) +
                        (g.stakeholder.name ? ` — ${g.stakeholder.name}` : "")}
                slots={buildSlots(g.docs, STK_EXPECTED,
                  (c) => stakeholderDocLabel(businessType, i, stakeholders.length, c))}
                openDoc={openDoc}
                eyeIcon={eyeIcon}
              />
            ))}
            {orphanStakeholderDocs.length > 0 && (
              <StakeholderDocs
                header="Legacy stakeholder documents"
                slots={buildSlots(orphanStakeholderDocs, [], (c) => plainStakeholderCatLabel(c))}
                openDoc={openDoc}
                eyeIcon={eyeIcon}
              />
            )}
          </div>
        </StepBlock>
      )}

      <StepBlock title="Bank (Step 4)">
        <DocGrid slots={toViewSlots(bankSlots, openDoc)} eyeIcon={eyeIcon} />
      </StepBlock>

      <StepBlock title="Office (Step 5)">
        <DocGrid slots={toViewSlots(officeSlots, openDoc)} eyeIcon={eyeIcon} />
      </StepBlock>

      {otherDocs.length > 0 && (
        <StepBlock title="Other">
          <DocGrid slots={toViewSlots(buildSlots(otherDocs, [], (c) => DOC_LABEL(c)), openDoc)} eyeIcon={eyeIcon} />
        </StepBlock>
      )}
    </div>
  );
}

// Maps this page's doc-row slots onto the shared ViewKit DocGrid slots.
// `doc` present → eye-View button; absent → greyed "Not uploaded".
function toViewSlots(slots: DocSlot[], openDoc: (id: string) => void): ViewDocSlot[] {
  return slots.map((s) => ({
    key: s.key,
    label: s.label,
    title: s.doc?.file_name ?? undefined,
    onView: s.doc ? () => openDoc(s.doc!.id) : undefined,
  }));
}

function StakeholderDocs({
  header, slots, openDoc, eyeIcon,
}: {
  header: string;
  slots: DocSlot[];
  openDoc: (id: string) => void;
  eyeIcon: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[12px] font-semibold text-[#0f3d2e] mb-1.5">{header}</p>
      <DocGrid slots={toViewSlots(slots, openDoc)} eyeIcon={eyeIcon} />
    </div>
  );
}

// ── Label helpers ────────────────────────────────────────────────────

function businessDocLabel(cat: string, bt: string | null): string {
  if (cat === "pan_business") return "PAN card";
  if (cat === "gstin")        return "GST registration";
  if (cat === "extra_doc") {
    if (bt === "partnership") return "Partnership Deed";
    if (bt === "pvt_ltd")     return "Certificate of Incorporation";
    if (bt === "llp")         return "LLP Agreement";
    return "Extra document";
  }
  return DOC_LABEL(cat);
}

function officeDocLabel(cat: string, bt: string | null): string {
  if (cat === "office_exterior") return "Exterior photo";
  if (cat === "office_interior") return "Interior photo";
  if (cat === "office_selfie") {
    switch (bt) {
      case "proprietorship":         return "Selfie of proprietor at office";
      case "partnership":
      case "llp":                    return "Selfie of at least 1 partner at office";
      case "pvt_ltd":                return "Selfie of at least 1 director at office";
      default:                       return "Selfie at office";
    }
  }
  return DOC_LABEL(cat);
}

// Role tag for a stakeholder header row.
// Proprietorship never carries a number (there's only one row).
function stakeholderRoleTag(bt: string | null, index: number, total: number): string {
  if (bt === "proprietorship") return "Proprietor";
  const role = roleLabel(bt);
  return `${role} ${index + 1}`;
}

// Label for a single stakeholder-doc card. Prefixed with the role tag
// (e.g. "Partner 1 PAN", "Director 2 Aadhaar (back)"). Proprietorship
// omits the number.
function stakeholderDocLabel(bt: string | null, index: number, total: number, cat: string): string {
  const prefix = bt === "proprietorship"
    ? "Proprietor"
    : `${roleLabel(bt)} ${index + 1}`;
  switch (cat) {
    case "stakeholder_pan":            return `${prefix} PAN`;
    case "stakeholder_aadhaar_front":  return `${prefix} Aadhaar (front)`;
    case "stakeholder_aadhaar_back":   return `${prefix} Aadhaar (back)`;
    case "stakeholder_aadhaar":        return `${prefix} Aadhaar (legacy)`;
    default:                           return `${prefix} ${DOC_LABEL(cat)}`;
  }
}

// Used when a stakeholder-doc row can't be attributed to a live
// stakeholder (orphaned by a Step-3 destructive-trim, for instance).
function plainStakeholderCatLabel(cat: string): string {
  switch (cat) {
    case "stakeholder_pan":            return "PAN";
    case "stakeholder_aadhaar_front":  return "Aadhaar (front)";
    case "stakeholder_aadhaar_back":   return "Aadhaar (back)";
    case "stakeholder_aadhaar":        return "Aadhaar (legacy)";
    default:                           return DOC_LABEL(cat);
  }
}
