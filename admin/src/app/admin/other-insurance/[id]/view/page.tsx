"use client";

// Other Insurance — view profile (/admin/other-insurance/[id]/view), main admin
// only. Same ViewKit layout as the Solar Insurance view: header card, tab row
// (Profile / Edit, Delete right), details, and the documents with eye + delete
// (and upload / replace) via OtherInsDocs.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { I, SectionCard, KV, Pill } from "@/components/view/ViewKit";
import ProfileTabBar, { TabButton } from "@/components/ProfileTabBar";
import OtherInsDocs, { otherInsDocLists } from "@/components/OtherInsDocs";
import { supabase } from "@/lib/supabase";
import { getBusiness, isMainAdmin } from "@/lib/auth";
import { invalidate } from "@/lib/list-cache";
import { fmtRupees } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { policyValidity } from "@/lib/insurance-validity";
import { deleteOtherIns, OTHER_INS_LIST_CACHE } from "@/lib/other-insurance";

export default function OtherInsuranceViewPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

type Row = Record<string, any>;

function Inner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const allowed = isMainAdmin(getBusiness());
  const [row, setRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    const { data } = await supabase().from("other_insurance").select("*").eq("id", params.id).maybeSingle();
    setRow(data);
    setLoading(false);
  }

  useEffect(() => {
    if (!allowed) { router.replace("/admin"); return; }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, params.id]);

  function back() {
    sessionStorage.setItem("adminList.tab", "otherins");
    router.push("/admin");
  }

  async function remove() {
    if (!row || deleting || !window.confirm("Delete this insurance file and all its documents?")) return;
    setDeleting(true);
    const r = await deleteOtherIns(row.id);
    setDeleting(false);
    if (!r.ok) { alert("Couldn't delete — " + r.error); return; }
    invalidate(OTHER_INS_LIST_CACHE);
    back();
  }

  if (!allowed) return null;
  if (loading) return <main className="min-h-screen grid place-items-center"><p className="text-[#5a8a76]">Loading…</p></main>;
  if (!row) return <main className="min-h-screen grid place-items-center"><p className="text-red-700">Insurance file not found.</p></main>;

  const docs = otherInsDocLists(row);
  const ensureId = async () => row.id as string;
  const docsChanged = () => { invalidate(OTHER_INS_LIST_CACHE); void load(); };
  const issued = !!row.policy_path;

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[#cdeadd] bg-white sticky top-0 z-30">
        <div className="w-full px-5 sm:px-8 h-14 flex items-center justify-between">
          <button onClick={back} className="text-[14px] text-[#5a8a76] hover:text-[#0f3d2e] inline-flex items-center gap-1">← Back to Other Insurance</button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/capital-craft.png" alt="Capital Craft" className="h-7 w-auto object-contain" />
        </div>
      </header>

      <div className="w-full px-5 sm:px-8 py-6" style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: "#0f3d2e" }}>
        <div className="rounded-[12px] border border-[#cdeadd] bg-[#f0faf5] p-5 sm:p-6 mb-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-14 h-14 rounded-[12px] bg-[#d6efe3] text-[#178a5c] grid place-items-center shrink-0" style={{ transform: "scale(1.3)", transformOrigin: "left center" }}>{I.user}</div>
              <div className="min-w-0">
                <div className="text-[24px] font-semibold text-[#0f3d2e] truncate">{row.customer_name || "(unnamed)"}</div>
                {row.insurance_company && <div className="text-[14px] text-[#5a8a76] truncate mt-0.5">{row.insurance_company}</div>}
              </div>
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <Pill tint="blue" icon={I.id}>{row.display_id ?? row.id.slice(0, 8).toUpperCase()}</Pill>
              <Pill tint={issued ? "blue" : "amber"}>{issued ? "Issued" : "Awaiting policy"}</Pill>
            </div>
          </div>
        </div>

        <ProfileTabBar
          left={
            <>
              <TabButton label="Profile" icon={I.user} active />
              <TabButton label="Edit" icon={I.edit} onClick={() => router.push(`/admin/other-insurance/${row.id}` as any)} />
            </>
          }
          right={
            <button type="button" onClick={() => void remove()} disabled={deleting}
              title="Delete" aria-label="Delete"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-semibold border border-red-300 text-red-700 rounded-[8px] hover:bg-red-50 hover:border-red-500 transition-colors disabled:opacity-60">
              {I.trash} {deleting ? "Deleting…" : "Delete"}
            </button>
          }
        />

        <div className="grid gap-4 lg:grid-cols-3 mt-4">
          <div className="flex flex-col gap-2.5">
            <SectionCard title="Customer" accent="blue" icon={I.user}>
              <KV k="Name" v={row.customer_name} />
              <KV k="Sum insured" v={row.sum_insured != null ? fmtRupees(row.sum_insured) : null} valueClass="text-[#178a5c]" />
              <KV k="Insurance company" v={row.insurance_company} />
            </SectionCard>
            <SectionCard title="Validity period" accent="blue" icon={I.invoice}>
              <KV k="Valid from" v={row.policy_from_date ? fmtDate(row.policy_from_date) : null} />
              <KV k="Valid to" v={row.policy_to_date ? fmtDate(row.policy_to_date) : null} />
              {row.policy_from_date && row.policy_to_date && <KV k="Validity" v={policyValidity(row.policy_from_date, row.policy_to_date)} />}
            </SectionCard>
          </div>

          <div className="flex flex-col gap-2.5">
            <SectionCard title={`KYC documents (${docs.kyc.length})`} accent="green" icon={I.id}>
              <OtherInsDocs kind="kyc" docs={docs.kyc} ensureId={ensureId} onChanged={docsChanged} />
            </SectionCard>
          </div>

          <div className="flex flex-col gap-2.5">
            <SectionCard title="Insurance policy" accent="green" icon={I.files}>
              <OtherInsDocs kind="policy" docs={docs.policy} ensureId={ensureId} onChanged={docsChanged} />
            </SectionCard>
          </div>
        </div>
      </div>
    </main>
  );
}
