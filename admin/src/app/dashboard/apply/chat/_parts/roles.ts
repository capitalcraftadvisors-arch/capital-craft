// Loan chat · who applies and who is the co-applicant: the two people's documents
// (names, ages, earning, the bill owner) decide it via lib/loan-roles.

import type { Form } from "@/components/chat/types";
import { nameReadable } from "@/lib/name-match";
import { coappReasonText, decideRoles, isBillOwner, personName, type IneligibleReason, type PersonFacts, type RoleDecision } from "@/lib/loan-roles";

// What an automatic (decision) turn does: an optional one-line bot message, the
// next form, and the turn to jump to (none → the next turn).
export type Step = { say?: string; form: Form; goto?: string };

// ── Applicant / co-applicant roles ───────────────────────────────────────────
// p1 (the first person uploaded) reads into the APPLICANT keys and p2 into the
// CO-APPLICANT keys. The two lists are index-aligned, so the automatic
// assignment can swap the two people. "_" keys stay in the browser (never
// submitted).
const APPLICANT_KEYS = [
  "aadhaar_name", "aadhaar_dob", "aadhaar_gender", "aadhaar_number", "aadhaar_care_of", "aadhaar_address",
  "aadhaar_front_path", "aadhaar_back_path", "aadhaar_face_path",
  "borrower_pan", "borrower_father_name", "_pan_name", "borrower_dob", "borrower_pan_path", "borrower_pan_mime", "borrower_pan_file_name", "_pan_url",
  "applicant_earning",
];
const COAPP_KEYS = [
  "coapp_aadhaar_name", "coapp_aadhaar_dob", "coapp_aadhaar_gender", "coapp_aadhaar_number", "coapp_aadhaar_care_of", "coapp_aadhaar_address",
  "coapp_aadhaar_front_path", "coapp_aadhaar_back_path", "coapp_aadhaar_face_path",
  "coapp_pan", "coapp_father_name", "_coapp_pan_name", "coapp_dob", "coapp_pan_path", "_coapp_pan_mime", "_coapp_pan_file_name", "_coapp_pan_url",
  "coapp_earning",
];
// Everything about one person, cleared when they must be re-uploaded.
const P1_RESET = [...APPLICANT_KEYS, "_p1_ids", "_p1_owner", "_p1_pan_required"];
const P2_RESET = [...COAPP_KEYS, "_p2_ids"];

const without = (f: Form, keys: string[]): Form => { const g = { ...f }; for (const k of keys) delete g[k]; return g; };
function swapPersons(f: Form): Form {
  const g = without(f, [...APPLICANT_KEYS, ...COAPP_KEYS]);
  APPLICANT_KEYS.forEach((a, i) => {
    const c = COAPP_KEYS[i];
    if (f[c] !== undefined) g[a] = f[c];
    if (f[a] !== undefined) g[c] = f[a];
  });
  return g;
}

export const yesNo = (v?: string): boolean | null => (v === "true" ? true : v === "false" ? false : null);
export const p1Of = (f: Form): PersonFacts => ({ aadhaarName: f.aadhaar_name, panName: f._pan_name, aadhaarDob: f.aadhaar_dob, panDob: f.borrower_dob, earning: yesNo(f.applicant_earning) });
export const p2Of = (f: Form): PersonFacts => ({ aadhaarName: f.coapp_aadhaar_name, panName: f._coapp_pan_name, aadhaarDob: f.coapp_aadhaar_dob, panDob: f.coapp_dob, earning: yesNo(f.coapp_earning) });
export const billName = (f: Form) => (nameReadable(f.ebill_name) ? f.ebill_name.trim() : "the bill owner");
export const n1 = (f: Form) => personName(p1Of(f)) || "the customer";
export const n2 = (f: Form) => personName(p2Of(f)) || (f._p2_role === "owner" ? billName(f) : "the applicant");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// The file has a co-applicant: the role decision, or (editing a filed
// application) the roles on file — else any co-applicant data already on it.
export const hasCoapp = (f: Form) => (f._has_coapp ? f._has_coapp === "1"
  : f.bill_on_applicant_name ? f.bill_on_applicant_name === "false"
  : !!(f.coapp_pan || f.coapp_aadhaar_number || f.coapp_pan_path || f.coapp_aadhaar_front_path));
// The EPC's "Is the bill in <name>'s name?" answer counts only while the bill
// name is unreadable — once a readable bill is uploaded, the names decide.
const p1OwnerAnswer = (f: Form) => (nameReadable(f.ebill_name) ? null : yesNo(f._p1_owner));
export const decide = (f: Form, withP2: boolean) => decideRoles({ ebillName: f.ebill_name, p1: p1Of(f), p2: withP2 ? p2Of(f) : null, p1IsOwner: p1OwnerAnswer(f) });

const WHY: Record<IneligibleReason, string> = { over_60: "is over 60", under_21: "is under 21", not_earning: "is not earning", dob_unknown: "has no readable date of birth" };

// Final roles from a decision: the applicant ends in the applicant keys, the
// co-applicant (pair only) in the co-applicant keys; a dropped person is cleared.
// In a pair the co-applicant is always the bill owner; alone, the applicant is.
function assignRoles(f: Form, d: Extract<RoleDecision, { kind: "single" | "pair" }>): Form {
  const pair = d.kind === "pair";
  const g = d.applicant === "p2" ? swapPersons(f) : f;
  const h = pair ? g : without(g, [...P2_RESET, "coapp_mobile", "coapp_relation"]);
  return {
    ...h,
    borrower_name: personName(p1Of(h)),
    coapp_name: pair ? personName(p2Of(h)) : "",
    coapp_role_reason: pair ? coappReasonText(d.reason) : "",
    _has_coapp: pair ? "1" : "0",
  };
}

// After the first person's documents + earning: they apply alone, or who the
// second person must be (an applicant beside the bill owner, or the bill owner).
export function firstDecision(f: Form): Step {
  // The bill owner's documents are mandatory: no PAN → back to the table with the PAN row required.
  if (!f.borrower_pan_path && (p1OwnerAnswer(f) ?? isBillOwner(p1Of(f), f.ebill_name))) {
    return { say: `${cap(n1(f))}'s PAN is required.`, form: { ...f, _p1_pan_required: "1" }, goto: "doc_table" };
  }
  const d = decide(f, false);
  if (d.kind === "single") return { say: `${cap(n1(f))} will be the applicant.`, form: assignRoles(f, d), goto: "coapp_relation" };
  if (d.kind === "need_p2") {
    // Replacing the applicant while the bill owner is already on file → straight to the final decision.
    if (d.p2Role === "owner" && f._p2_role === "owner" && f.coapp_aadhaar_front_path) return { form: f, goto: "p2_decision" };
    return d.p2Role === "owner"
      ? { say: nameReadable(f.ebill_name) ? `The electricity bill is in ${billName(f)}'s name.` : undefined, form: { ...f, _p2_role: "owner" } }
      : { say: `${cap(n1(f))} ${WHY[d.reason.slice(6) as IneligibleReason]} and will be the co-applicant.`, form: { ...f, _p2_role: "applicant" } };
  }
  if (d.kind === "ask_owner") return { form: f, goto: "p1_owner" };
  if (d.kind === "need_dob") return { form: f, goto: "p1_dob" };
  return { form: f };
}

// The second person was asked for as the bill owner — their name must match the bill.
const notOwner = (f: Form): Step => ({ say: `This isn't ${billName(f)}.`, form: without(f, P2_RESET), goto: "p2_docs" });
export function ownerCheck(f: Form): Step {
  return f._p2_role === "owner" && isBillOwner(p2Of(f), f.ebill_name) === false ? notOwner(f) : { form: f };
}

// With both people: assign the roles, or ask for a different person (that
// person's keys are cleared, so the table needs a new upload).
export function finalDecision(f: Form): Step {
  const d = decide(f, true);
  if (d.kind === "single" || d.kind === "pair") {
    const g = assignRoles(f, d);
    return {
      say: d.kind === "single"
        ? `${cap(g.borrower_name || "the applicant")} will be the sole applicant.`
        : `${cap(g.borrower_name || "the applicant")} will be the applicant and ${g.coapp_name || "the bill owner"} the co-applicant.`,
      form: g,
    };
  }
  if (d.kind === "need_new_applicant") {
    return d.replace === "p2"
      ? { say: `${cap(n2(f))} ${WHY[d.reason]} and can't be the applicant.`, form: without(f, P2_RESET), goto: "p2_docs" }
      : { say: `Neither ${n1(f)} nor ${n2(f)} can be the applicant.`, form: without(f, P1_RESET), goto: "doc_table" };
  }
  if (d.kind === "p2_not_owner") return notOwner(f);
  if (d.kind === "need_dob") return { form: f, goto: d.who === "p1" ? "p1_dob" : "p2_dob" };
  if (d.kind === "ask_owner") return { form: f, goto: "p1_owner" };
  return { form: f, goto: "p2_docs" };
}
