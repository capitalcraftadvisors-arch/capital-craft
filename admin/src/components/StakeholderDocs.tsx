"use client";

// Documents of a team member or partner (stakeholder_docs, 0106). The expected
// documents are slots — one each, a new upload replaces it — plus any number
// of Other documents (shown by file name). View / download / delete through the
// shared DocGrid, so the profile delete rule (owner only, always confirmed)
// applies here too.

import { useEffect, useState } from "react";
import { DocGrid, FillCount, I, Section, type ViewDocSlot } from "@/components/view/ViewKit";
import { deleteDocument, getDocumentUrl, uploadDocument } from "@/lib/storage";
import { listStakeholderDocs, OTHER_DOC, type StakeholderDoc } from "@/lib/stakeholders";
import { inputCls } from "@/components/StakeholderDetails";

type Owner = { team_id: string } | { partner_id: string };

export default function StakeholderDocs({ owner, slots }: { owner: Owner; slots: string[] }) {
  const [docs, setDocs] = useState<StakeholderDoc[] | null>(null);
  const [kind, setKind] = useState(slots[0] ?? OTHER_DOC);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ownerKey = JSON.stringify(owner);
  useEffect(() => {
    void listStakeholderDocs(owner).then(setDocs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setError(null);
    for (const file of Array.from(files)) {
      const r = await uploadDocument(file, { table: "stakeholder_docs", category: kind, ...owner, replace: kind !== OTHER_DOC });
      if (!r.ok) { setError(r.error); break; }
    }
    setDocs(await listStakeholderDocs(owner));
    setBusy(false);
  }
  async function open(id: string, download?: boolean) {
    const url = await getDocumentUrl(id, { download });
    if (url) window.open(url, "_blank", "noopener"); else alert("Couldn't open the document.");
  }
  async function remove(id: string) {
    if (await deleteDocument(id)) setDocs((d) => d?.filter((x) => x.id !== id) ?? d);
    else alert("Couldn't delete the document.");
  }

  const slotOf = (d: StakeholderDoc | undefined, key: string, label: string): ViewDocSlot => ({
    key, label, title: d?.file_name ?? undefined,
    onView: d ? () => void open(d.id) : undefined,
    onDownload: d ? () => void open(d.id, true) : undefined,
    onDelete: d ? () => void remove(d.id) : undefined,
  });
  const latest = (label: string) => [...(docs ?? [])].reverse().find((d) => d.category === label);
  const viewSlots: ViewDocSlot[] = docs ? [
    ...slots.map((label) => slotOf(latest(label), label, label)),
    ...docs.filter((d) => !slots.includes(d.category))
      .map((d) => slotOf(d, d.id, d.file_name?.replace(/\.[^.]+$/, "") || "Other document")),
  ] : [];
  const have = slots.filter((s) => latest(s)).length;

  return (
    <Section card white icon={I.files} title="Documents" summary={docs ? <FillCount have={have} total={slots.length} /> : undefined}>
      {!docs ? (
        <p className="text-[13px] text-[#7a958a]">Loading…</p>
      ) : (
        <div className="space-y-4">
          <DocGrid slots={viewSlots} eyeIcon={I.eye} />
          <div className="flex items-center gap-2 pt-1">
            <select className={`${inputCls} !w-auto flex-1 min-w-0`} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Document type">
              {[...slots, OTHER_DOC].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <label className={["shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-[13px] font-semibold text-white bg-[#178a5c] hover:bg-[#12734c] cursor-pointer", busy ? "opacity-60 pointer-events-none" : ""].join(" ")}>
              {busy ? "Uploading…" : "＋ Upload"}
              <input type="file" multiple={kind === OTHER_DOC} accept="image/*,application/pdf" className="hidden"
                onChange={(e) => { void upload(e.target.files); e.currentTarget.value = ""; }} />
            </label>
          </div>
          {error && <p className="text-[12px] text-red-600">{error}</p>}
        </div>
      )}
    </Section>
  );
}
