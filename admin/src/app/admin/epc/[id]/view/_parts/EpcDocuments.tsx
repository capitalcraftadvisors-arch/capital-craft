"use client";

// EPC View · the Documents card: every document grouped by onboarding step (missing
// ones greyed), and the expected-document list that approving checks against.

import { DocGrid, StepBlock, type ViewDocSlot } from "@/components/view/ViewKit";

export type Doc = {
  id: string;
  category: string;
  file_name: string | null;
  mime_type: string | null;
  stakeholder_id: string | null;
  metadata: Record<string, unknown> | null;
};

export function roleLabel(bt: string | null | undefined): string {
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
    bank_statement: "Bank statement",
    stakeholder_pan: "Member PAN",
    stakeholder_aadhaar: "Aadhaar (legacy)",
    stakeholder_aadhaar_front: "Aadhaar F",
    stakeholder_aadhaar_back: "Aadhaar B",
    office_exterior: "Office ext",
    office_interior: "Office int",
    office_selfie: "Selfie",
    gst_r3b: "GSTR-3B",
    custom_quote_sample: "Sample quotation",
  };
  return M[cat] ?? cat;
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
const BANK_CATS   = ["cancelled_cheque", "bank_statement"] as const;
const OFFICE_CATS = ["office_exterior", "office_interior", "office_selfie"] as const;

type DocSlot = { key: string; label: string; doc: Doc | null };
export type Stakeholder = { id: string; name?: string; designation?: string; mobile?: string; email?: string };

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

// The documents an EPC profile should have, grouped as the Documents card shows
// them: each expected slot (empty → "Not uploaded") plus any extra uploads.
function epcDocGroups(docs: Doc[], stakeholders: Stakeholder[], businessType: string | null) {
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
  const bankSlots   = buildSlots(bankDocs, ["cancelled_cheque"], (c) => c === "cancelled_cheque" ? "Empty cheque copy / picture" : DOC_LABEL(c));
  const officeSlots = buildSlots(
    officeDocs,
    ["office_exterior", "office_interior", "office_selfie"],
    (c) => officeDocLabel(c, businessType),
  );
  const STK_EXPECTED = ["stakeholder_pan", "stakeholder_aadhaar_front", "stakeholder_aadhaar_back"];
  const stakeholderSlots = stakeholderGroups.map((g, i) => ({
    key: g.stakeholder.id ?? String(i),
    header: stakeholderRoleTag(businessType, i) + (g.stakeholder.name ? ` — ${g.stakeholder.name}` : ""),
    slots: buildSlots(g.docs, STK_EXPECTED, (c) => stakeholderDocLabel(businessType, i, c)),
  }));
  return { bizSlots, stakeholderSlots, orphanStakeholderDocs, bankSlots, officeSlots, otherDocs };
}

// Every document slot the profile counts (uploaded or not).
export function expectedEpcSlots(docs: Doc[], stakeholders: Stakeholder[], businessType: string | null): DocSlot[] {
  const g = epcDocGroups(docs, stakeholders, businessType);
  // An older single-file Aadhaar (both sides in one) covers front + back.
  const stk = g.stakeholderSlots.flatMap((x) => {
    const combined = x.slots.some((s) => s.doc?.category === "stakeholder_aadhaar");
    return x.slots.filter((s) => !(combined && /^stakeholder_aadhaar_(front|back)-/.test(s.key)));
  });
  return [...g.bizSlots, ...stk, ...g.bankSlots, ...g.officeSlots];
}

// Labels of the expected documents not uploaded yet.
export function missingEpcDocs(docs: Doc[], stakeholders: Stakeholder[], businessType: string | null): string[] {
  return expectedEpcSlots(docs, stakeholders, businessType).filter((x) => !x.doc).map((x) => x.label);
}

export function DocumentsBySteps({
  docs, stakeholders, businessType, openDoc, removeDoc, downloadDoc, eyeIcon,
}: {
  docs: Doc[];
  stakeholders: Stakeholder[];
  businessType: string | null;
  openDoc: (id: string) => void;
  removeDoc: (id: string) => void;
  downloadDoc: (id: string) => void;
  eyeIcon: React.ReactNode;
}) {
  const { bizSlots, stakeholderSlots, orphanStakeholderDocs, bankSlots, officeSlots, otherDocs } =
    epcDocGroups(docs, stakeholders, businessType);
  return (
    <div className="space-y-4">
      <StepBlock title="Business (Step 2)">
        <DocGrid slots={toViewSlots(bizSlots, openDoc, removeDoc, downloadDoc)} eyeIcon={eyeIcon} />
      </StepBlock>

      {(stakeholderSlots.length > 0 || orphanStakeholderDocs.length > 0) && (
        <StepBlock title="Stakeholders (Step 3)">
          <div className="space-y-2.5">
            {stakeholderSlots.map((g) => (
              <StakeholderDocs
                key={g.key}
                header={g.header}
                slots={g.slots}
                openDoc={openDoc}
                removeDoc={removeDoc}
                downloadDoc={downloadDoc}
                eyeIcon={eyeIcon}
              />
            ))}
            {orphanStakeholderDocs.length > 0 && (
              <StakeholderDocs
                header="Legacy stakeholder documents"
                slots={buildSlots(orphanStakeholderDocs, [], (c) => plainStakeholderCatLabel(c))}
                openDoc={openDoc}
                removeDoc={removeDoc}
                downloadDoc={downloadDoc}
                eyeIcon={eyeIcon}
              />
            )}
          </div>
        </StepBlock>
      )}

      <StepBlock title="Bank (Step 4)">
        <DocGrid slots={toViewSlots(bankSlots, openDoc, removeDoc, downloadDoc)} eyeIcon={eyeIcon} />
      </StepBlock>

      <StepBlock title="Office (Step 5)">
        <DocGrid slots={toViewSlots(officeSlots, openDoc, removeDoc, downloadDoc)} eyeIcon={eyeIcon} />
      </StepBlock>

      {otherDocs.length > 0 && (
        <StepBlock title="Other">
          <DocGrid slots={toViewSlots(buildSlots(otherDocs, [], (c) => DOC_LABEL(c)), openDoc, removeDoc, downloadDoc)} eyeIcon={eyeIcon} />
        </StepBlock>
      )}
    </div>
  );
}

// Maps this page's doc-row slots onto the shared ViewKit DocGrid slots.
// `doc` present → eye-View button; absent → greyed "Not uploaded".
function toViewSlots(
  slots: DocSlot[], openDoc: (id: string) => void, removeDoc?: (id: string) => void,
  downloadDoc?: (id: string) => void,
): ViewDocSlot[] {
  return slots.map((s) => ({
    key: s.key,
    label: s.label,
    title: s.doc?.file_name ?? undefined,
    onView: s.doc ? () => openDoc(s.doc!.id) : undefined,
    onDownload: s.doc && downloadDoc ? () => downloadDoc(s.doc!.id) : undefined,
    onDelete: s.doc && removeDoc ? () => removeDoc(s.doc!.id) : undefined,
  }));
}

function StakeholderDocs({
  header, slots, openDoc, removeDoc, downloadDoc, eyeIcon,
}: {
  header: string;
  slots: DocSlot[];
  openDoc: (id: string) => void;
  removeDoc?: (id: string) => void;
  downloadDoc?: (id: string) => void;
  eyeIcon: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[12px] font-semibold text-[#0f3d2e] mb-1.5">{header}</p>
      <DocGrid slots={toViewSlots(slots, openDoc, removeDoc, downloadDoc)} eyeIcon={eyeIcon} />
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
function stakeholderRoleTag(bt: string | null, index: number): string {
  if (bt === "proprietorship") return "Proprietor";
  const role = roleLabel(bt);
  return `${role} ${index + 1}`;
}

// Label for a single stakeholder-doc card. Prefixed with the role tag
// (e.g. "Partner 1 PAN", "Director 2 Aadhaar (back)"). Proprietorship
// omits the number.
function stakeholderDocLabel(bt: string | null, index: number, cat: string): string {
  const prefix = stakeholderRoleTag(bt, index);
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
