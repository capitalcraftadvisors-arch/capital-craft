"use client";

// Other Insurance file form — /admin/other-insurance/[id] (id = "new" to add one).
// Main admin only (migration 0093). One simple form: KYC documents (as many as
// needed) → insurance policy → validity period → customer name, plus optional
// sum insured / insurance company. The row is created on the first upload or
// save, so an abandoned "new" form leaves nothing behind. Save opens the file's
// view profile (/view).

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import DateField from "@/components/ui/DateField";
import { I, SectionCard } from "@/components/view/ViewKit";
import OtherInsDocs, { otherInsDocLists } from "@/components/OtherInsDocs";
import { supabase } from "@/lib/supabase";
import { getBusiness, isMainAdmin } from "@/lib/auth";
import { invalidate } from "@/lib/list-cache";
import { OTHER_INS_LIST_CACHE } from "@/lib/other-insurance";

export default function OtherInsuranceFormPage() {
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
  const [rowId, setRowId] = useState<string | null>(params.id === "new" ? null : params.id);
  const [row, setRow] = useState<Row | null>(null);
  const [name, setName] = useState("");
  const [sumInsured, setSumInsured] = useState("");
  const [company, setCompany] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(params.id !== "new");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-reads the row (documents). The typed fields are only seeded on open, so a
  // document upload never wipes what's being typed.
  async function loadRow(id: string): Promise<Row | null> {
    const { data, error: e } = await supabase().from("other_insurance").select("*").eq("id", id).maybeSingle();
    if (e) setError(e.message);
    setRow(data);
    return data;
  }

  useEffect(() => {
    if (!allowed) { router.replace("/admin"); return; }
    if (params.id === "new") return;
    void loadRow(params.id).then((data) => {
      if (data) {
        setName(data.customer_name ?? "");
        setSumInsured(data.sum_insured != null ? String(data.sum_insured) : "");
        setCompany(data.insurance_company ?? "");
        setFrom(data.policy_from_date ?? "");
        setTo(data.policy_to_date ?? "");
      }
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, params.id]);

  const fields = () => ({
    customer_name: name.trim() || null,
    sum_insured: Number(sumInsured) > 0 ? Number(sumInsured) : null,
    insurance_company: company.trim() || null,
    policy_from_date: from || null,
    policy_to_date: to || null,
  });

  // The row is created on the first upload / save.
  async function ensureId(): Promise<string | null> {
    if (rowId) return rowId;
    const { data, error: e } = await supabase().from("other_insurance")
      .insert({ ...fields(), created_by_user_id: getBusiness()?.id ?? null })
      .select("id").single();
    if (e || !data) { setError("Couldn't create the file — " + (e?.message ?? "unknown error")); return null; }
    setRowId(data.id);
    window.history.replaceState(null, "", `/admin/other-insurance/${data.id}`);
    return data.id;
  }

  const docsChanged = (id: string) => { invalidate(OTHER_INS_LIST_CACHE); void loadRow(id); };

  async function save() {
    if (saving) return;
    if (!name.trim()) { setError("Customer name is required."); return; }
    if (from && to && to < from) { setError("Valid to can't be before valid from."); return; }
    setSaving(true); setError(null);
    const id = await ensureId();
    if (id) {
      const { error: e } = await supabase().from("other_insurance").update(fields()).eq("id", id);
      if (e) setError("Couldn't save — " + e.message);
      else { invalidate(OTHER_INS_LIST_CACHE); router.push(`/admin/other-insurance/${id}/view` as any); return; }
    }
    setSaving(false);
  }

  function back() {
    if (rowId) { router.push(`/admin/other-insurance/${rowId}/view` as any); return; }
    sessionStorage.setItem("adminList.tab", "otherins");
    router.push("/admin");
  }

  if (!allowed) return null;
  if (loading) return <main className="min-h-screen grid place-items-center"><p className="text-[#5a8a76]">Loading…</p></main>;
  if (rowId && !row) return <main className="min-h-screen grid place-items-center"><p className="text-red-700">Insurance file not found.</p></main>;

  const docs = otherInsDocLists(row);
  const inputCls = "w-full border border-[#cdeadd] rounded-[8px] px-3 py-2.5 text-[14px] focus:border-[#185fa5] outline-none bg-white";

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-[#cdeadd] bg-white sticky top-0 z-30">
        <div className="w-full px-5 sm:px-8 h-14 flex items-center justify-between">
          <button onClick={back} className="text-[14px] text-[#5a8a76] hover:text-[#0f3d2e] inline-flex items-center gap-1">
            ← {rowId ? "Back to profile" : "Back to Other Insurance"}
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/capital-craft.png" alt="Capital Craft" className="h-7 w-auto object-contain" />
        </div>
      </header>

      <section className="max-w-3xl mx-auto px-5 sm:px-8 py-8 space-y-5">
        <div>
          <h1 className="font-display text-[24px] font-bold text-[#0f3d2e]">{row?.customer_name || "New insurance file"}</h1>
          {row?.display_id && <p className="text-[12px] font-mono text-[#185fa5] mt-0.5">{row.display_id}</p>}
        </div>

        <SectionCard title="KYC documents" accent="green" icon={I.id}>
          <OtherInsDocs kind="kyc" docs={docs.kyc} ensureId={ensureId} onChanged={docsChanged} editable />
        </SectionCard>

        <SectionCard title="Insurance policy" accent="green" icon={I.files}>
          <OtherInsDocs kind="policy" docs={docs.policy} ensureId={ensureId} onChanged={docsChanged} editable />
        </SectionCard>

        <SectionCard title="Validity period" accent="green" icon={I.invoice}>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <p className="text-[12px] text-[#5a8a76] mb-1">Valid from</p>
              <DateField className={inputCls} value={from} onChange={setFrom} ariaLabel="Valid from" />
            </div>
            <div>
              <p className="text-[12px] text-[#5a8a76] mb-1">Valid to</p>
              <DateField className={inputCls} value={to} onChange={setTo} min={from || undefined} ariaLabel="Valid to" />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Customer" accent="green" icon={I.user}>
          <div className="space-y-3">
            <div>
              <p className="text-[12px] text-[#5a8a76] mb-1">Customer name</p>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <p className="text-[12px] text-[#5a8a76] mb-1">Sum insured (optional)</p>
                <input className={inputCls} inputMode="decimal" value={sumInsured}
                  onChange={(e) => setSumInsured(e.target.value.replace(/[^\d.]/g, ""))} />
              </div>
              <div>
                <p className="text-[12px] text-[#5a8a76] mb-1">Insurance company (optional)</p>
                <input className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} />
              </div>
            </div>
          </div>
        </SectionCard>

        {error && <p className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-[8px] px-3 py-2">{error}</p>}
        <div className="flex justify-end">
          <button type="button" onClick={() => void save()} disabled={saving}
            className="px-5 py-2.5 bg-[#178a5c] text-white rounded-[8px] text-[14px] font-semibold hover:bg-[#12734c] disabled:opacity-60">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </section>
    </main>
  );
}
