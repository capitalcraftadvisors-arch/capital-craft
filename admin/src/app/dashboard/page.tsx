"use client";

// EPC PORTAL — the partner cockpit. A navy sidebar shell over five sections:
//   Dashboard (KPI band + unified attention + pipeline + today's activity + RM;
//              Partner Portal v2 — the demo EPC — gets DashboardV2 instead)
//   Loans (8-column table → per-application timeline drawer)
//   Insurance (the EPC's own policies; v2 adds Due for renewal + Renew)
//   EMI calculator (PM Surya Ghar subsidy + live EMI, reusing lib/emi)
//   Documents (download center — first pass)
// All reads are RLS-scoped to the logged-in EPC (own_applications / own_insurance).

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import LoginWelcome from "@/components/LoginWelcome";
import PartnerShell, { PARTNER_SECTIONS, type PartnerSection } from "@/components/partner/PartnerShell";
import { authHeaders, getBusiness, greetingName, loanAccess, insuranceAccess } from "@/lib/auth";
import { canWork, hasModule, isSiteStaff, portalV2 } from "@/lib/epc-roles";
import DashboardV2 from "@/components/partner/DashboardV2";
import { fetchEpcName, shortEpcName } from "@/lib/epc-name";
import { supabase } from "@/lib/supabase";
import { notify } from "@/lib/notify";
import { fetchQuoteTemplate, type QuoteTemplate } from "@/lib/quotation-template";
import { SARVATRA } from "@/lib/quotation-brands";
import CustomerApplications from "@/components/quotation/CustomerApplications";
import CustomTemplateBanner from "@/components/partner/CustomTemplateBanner";
import { RMS, lastChangeTs, type AppRow, type FilterKey, type InsFilter, type InsRow } from "./_parts/rows";
import HomeSection from "./_parts/HomeSection";
import LoansSection from "./_parts/LoansSection";
import InsuranceSection from "./_parts/InsuranceSection";
import EmiSection from "./_parts/EmiSection";
import DocumentsSection from "./_parts/DocumentsSection";
import TimelineDrawer from "./_parts/TimelineDrawer";

type Section = PartnerSection;

export default function DashboardPage() {
  return (
    <AuthGuard allow={["approved"]}>
      <SiteStaffToProjects><DashboardInner /></SiteStaffToProjects>
    </AuthGuard>
  );
}

// Site staff (0128) work only on their projects — straight there, nothing else loads.
function SiteStaffToProjects({ children }: { children: ReactNode }) {
  const router = useRouter();
  const site = isSiteStaff(getBusiness());
  useEffect(() => { if (site) router.replace("/dashboard/projects"); }, [site, router]);
  return site ? null : <>{children}</>;
}

function DashboardInner() {
  const router = useRouter();
  const [rows, setRows] = useState<AppRow[]>([]);
  const [insRows, setInsRows] = useState<InsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [insBusy, setInsBusy] = useState(false);
  const [openCase, setOpenCase] = useState<AppRow | null>(null);
  // Quotations: an EPC with its own builder (an epc_quotation_templates row, RLS
  // scoped) uses it; every other EPC gets the standard saved Quotations.
  // gozerobils (Sustera Ventures) builds quotations in Customer applications.
  const [quoteTpl, setQuoteTpl] = useState<QuoteTemplate | null>(null);
  const customers = quoteTpl?.storage_path === SARVATRA.key;

  const me = getBusiness();
  // A staff login (0119): its modules narrow the sections; a Viewer only reads.
  const canLoan = loanAccess(me) && hasModule(me, "loans");
  const canInsurance = insuranceAccess(me) && hasModule(me, "insurance");
  const work = canWork(me);
  const v2 = portalV2(me);
  const [section, setSection] = useState<Section>("home");
  // The filter a section opens with (a v2 dashboard tile); the menu opens it unfiltered.
  const [loanFilter, setLoanFilter] = useState<FilterKey>("all");
  const [insFilter, setInsFilter] = useState<InsFilter>("all");
  // The section is kept in the address (?s=<section>), so Back from a page opened here returns to it.
  const show = (s: Section) => { setSection(s); window.history.replaceState(null, "", s === "home" ? "/dashboard" : `/dashboard?s=${s}`); };
  const open = (s: Section) => { setLoanFilter("all"); setInsFilter("all"); show(s); };
  // Opened from another partner page's nav (/dashboard?s=loans).
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("s") as Section | null;
    if (s && PARTNER_SECTIONS.includes(s)) setSection(s);
  }, []);
  const [epcName, setEpcName] = useState(() => shortEpcName(me?.contact_name) || greetingName(me));
  useEffect(() => { void fetchEpcName().then(setEpcName); }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase().from("epc_applications").select(
        "id, borrower_name, aadhaar_name, loan_display_id, loan_amount, loan_amount_required, " +
        "project_size, project_size_unit, sanctioned_amount, first_disbursement_amount, first_disbursement_date, " +
        "second_disbursement_amount, second_disbursement_date, submitted_at, reviewed_at, docs_sent_at, " +
        "approved_at, rejected_at, rejection_reason, epc_updated_at, edit_locked, edit_allow, status, created_at, aadhaar_front_path, " +
        "attention_status, attention_raised_at, msg_epc_seen_at").order("created_at", { ascending: false });
      // Hide blank drafts — a draft with no Aadhaar yet is an abandoned mobile-only
      // shell (the register step creates it); it isn't a real profile until the EPC
      // uploads at least the Aadhaar.
      setRows(((data ?? []) as unknown as AppRow[]).filter((r) => !(r.status === "draft" && !r.aadhaar_front_path)));
      const { data: ins } = await supabase().from("insurance_applications").select(
        "id, insurance_display_id, aadhaar_name, sum_insured, invoice_confirmed_amount, insurance_partner, " +
        "policy_from_date, policy_to_date, status, created_at, attention_status, attention_raised_at, msg_epc_seen_at")
        .order("created_at", { ascending: false });
      setInsRows((ins ?? []) as unknown as InsRow[]);
      setLoading(false);
      try { setQuoteTpl(await fetchQuoteTemplate(true)); } catch { setQuoteTpl(null); }
    })();
  }, []);

  async function startInsurance() {
    if (insBusy) return;
    setInsBusy(true);
    try {
      const res = await fetch("/api/epc/insurance/create", { method: "POST", headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) { notify.error("Couldn't start the insurance application: " + (data?.error || `HTTP ${res.status}`)); return; }
      router.push(`/dashboard/insurance/${data.application.id}/chat`);
    } catch (e) { notify.error("Network error: " + (e as Error).message); } finally { setInsBusy(false); }
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  // Profiles Capital Craft has flagged (attention open), loan + insurance — the
  // Document pending section lists them; the sidebar shows the total as a red count.
  const attnCount = rows.filter((r) => r.attention_status === "open").length
    + insRows.filter((r) => r.attention_status === "open").length;

  const sortedLoans = useMemo(() => [...rows].sort((a, b) => lastChangeTs(b) - lastChangeTs(a)), [rows]);

  return (
    <PartnerShell active={section} onSection={open} badge={attnCount} quoteTpl={quoteTpl}
      title={<h1 className="font-display text-[22px] sm:text-[28px] font-bold text-cc-ink">नमस्ते, {epcName}</h1>}>
      <LoginWelcome />

      <main className="px-5 sm:px-8 pb-12 pt-3">
        {section === "home" && hasModule(me, "quotes") && <CustomTemplateBanner tpl={quoteTpl} />}
        {section === "home" && v2 && (
          <DashboardV2 rms={RMS} customers={customers && hasModule(me, "quotes")}
            onQuotation={() => (customers ? show("customers") : router.push("/dashboard/quotes"))}
            onLoans={(f) => { setLoanFilter(f); show("loans"); }}
            onInsurance={(due) => { setInsFilter(due ? "renewal" : "all"); show("insurance"); }}
            onRenew={() => void startInsurance()} renewing={insBusy}
            onOpenMessage={(id) => router.push(`/dashboard/messages/loan/${id}`)} />
        )}
        {section === "home" && !v2 && (
          <HomeSection loans={rows} loading={loading} attnCount={attnCount}
            canLoan={canLoan && work} canInsurance={canInsurance && work}
            onApplyLoan={() => router.push("/dashboard/apply/chat")}
            onApplyInsurance={() => void startInsurance()} applyingInsurance={insBusy}
            onOpenCase={(r) => setOpenCase(r)} onEmi={() => show("emi")}
            canQuote={hasModule(me, "quotes")} onQuotation={() => (customers ? show("customers") : router.push("/dashboard/quotes"))} onAttention={() => show("documents")} />
        )}
        {section === "loans" && (
          <LoansSection loans={sortedLoans} loading={loading} canLoan={canLoan && work} readOnly={!work} initial={loanFilter}
            onOpenCase={(r) => setOpenCase(r)} onApply={() => router.push("/dashboard/apply/chat")}
            onEdit={(r) => router.push(`/dashboard/apply/chat?id=${r.id}&edit=1`)}
            onTranche={(r) => router.push(`/dashboard/${r.id}/disbursement`)} />
        )}
        {section === "insurance" && (
          <InsuranceSection insRows={insRows} loading={loading} onApply={work ? () => void startInsurance() : null} applying={insBusy}
            v2={v2} initial={insFilter} onRenew={v2 && work ? () => void startInsurance() : null}
            // A draft continues in the chat; a sent one opens its form to view / change.
            onOpen={(id) => router.push(`/dashboard/insurance/${id}/${insRows.find((r) => r.id === id)?.status === "draft" ? "chat" : "step-1"}`)} />
        )}
        {section === "emi" && <EmiSection />}
        {section === "customers" && customers && <CustomerApplications serialNext={quoteTpl.serial_next} whatsapp={!!quoteTpl.unlocked}
          onSerial={(n) => setQuoteTpl((t) => t && { ...t, serial_next: Math.max(t.serial_next ?? 1, n) })} />}
        {section === "documents" && <DocumentsSection loans={rows} insRows={insRows} onOpenMessage={(kind, id) => router.push(`/dashboard/messages/${kind}/${id}`)} />}
      </main>

      {openCase && (
        <TimelineDrawer row={openCase} onClose={() => setOpenCase(null)} readOnly={!work}
          onEdit={() => router.push(`/dashboard/apply/chat?id=${openCase.id}&edit=1`)}
          onTranche={() => router.push(`/dashboard/${openCase.id}/disbursement`)}
          onMessage={() => router.push(`/dashboard/messages/loan/${openCase.id}`)} />
      )}
    </PartnerShell>
  );
}
