// Applicant / co-applicant segregation for the EPC loan chatbot — pure rules,
// no React, no IO. The chat calls decideRoles after each person's documents
// (and their "earning?" answer) and acts on the returned step, so roles are
// decided in the browser and written in ONE submit.
//
// Rules:
//   • Eligible to be APPLICANT ⇔ age 21..60 inclusive AND earning.
//   • The electricity-bill owner must be on the file: as applicant when
//     eligible, else as co-applicant beside an eligible applicant.
//   • p1 = first person uploaded; p2 = second, asked for only when needed.

import { ageRange } from "./dates";
import { nameReadable, namesLikelySame } from "./name-match";

export type PersonFacts = {
  aadhaarName?: string | null; panName?: string | null;
  aadhaarDob?: string | null;  panDob?: string | null;
  earning?: boolean | null;
};
export type IneligibleReason = "over_60" | "under_21" | "not_earning" | "dob_unknown";
export type Eligibility = { eligible: boolean; needDob: boolean; reason: IneligibleReason | null; age: { min: number; max: number } | null };
export type CoappReason = "owner_over_60" | "owner_under_21" | "owner_not_earning" | "bill_other_name";
export type RoleDecision =
  | { kind: "ask_owner" }                                   // bill name unreadable → chat asks "Is the bill in <p1>'s name?"
  | { kind: "need_dob"; who: "p1" | "p2" }
  | { kind: "need_p2"; p2Role: "applicant" | "owner"; reason: CoappReason }
  | { kind: "p2_not_owner" }                                // asked for the bill owner, p2's name doesn't match the bill
  | { kind: "need_new_applicant"; replace: "p1" | "p2"; reason: IneligibleReason }
  | { kind: "single"; applicant: "p1" | "p2"; dropP1: boolean }
  | { kind: "pair"; applicant: "p1" | "p2"; coapp: "p1" | "p2"; reason: CoappReason };

const MIN_AGE = 21;
const MAX_AGE = 60;

const COAPP_REASON_TEXT: Record<CoappReason, string> = {
  owner_over_60: "Bill owner is over 60",
  owner_under_21: "Bill owner is under 21",
  owner_not_earning: "Bill owner is not earning",
  bill_other_name: "Electricity bill is in the co-applicant's name",
};

/** Name on the person's ID — Aadhaar first, else PAN. */
export function personName(p: PersonFacts): string {
  return (p.aadhaarName || "").trim() || (p.panName || "").trim();
}

/** Aadhaar and PAN name the same person (true when either name is unreadable). */
export function idNamesMatch(p: PersonFacts): boolean {
  return namesLikelySame(p.aadhaarName, p.panName);
}

/** Whether the electricity bill is in this person's name; null when the bill name is unreadable. */
export function isBillOwner(p: PersonFacts, ebillName: string | null | undefined): boolean | null {
  if (!nameReadable(ebillName)) return null;
  return namesLikelySame(personName(p), ebillName);
}

export function eligibility(p: PersonFacts, today: Date = new Date()): Eligibility {
  // Aadhaar DOB preferred, but an EXACT date beats a year-only one: older
  // Aadhaar cards print only the year while the PAN carries the full date, and
  // a DOB the EPC types in may land on either key.
  const a = ageRange(p.aadhaarDob, today);
  const n = ageRange(p.panDob, today);
  const age = (a && a.min === a.max ? a : null) || (n && n.min === n.max ? n : null) || a || n;
  // Unreadable, or a year-only range straddling 21 or 60 → only the exact DOB decides.
  if (!age || (age.min < MIN_AGE && age.max >= MIN_AGE) || (age.min <= MAX_AGE && age.max > MAX_AGE)) {
    return { eligible: false, needDob: true, reason: "dob_unknown", age };
  }
  if (age.max < MIN_AGE) return { eligible: false, needDob: false, reason: "under_21", age };
  if (age.min > MAX_AGE) return { eligible: false, needDob: false, reason: "over_60", age };
  if (p.earning !== true) return { eligible: false, needDob: false, reason: "not_earning", age };
  return { eligible: true, needDob: false, reason: null, age };
}

export function decideRoles(input: { ebillName: string | null | undefined; p1: PersonFacts; p2?: PersonFacts | null; p1IsOwner?: boolean | null; today?: Date }): RoleDecision {
  const { ebillName, p1, p2, today = new Date() } = input;
  const p1Owner = input.p1IsOwner ?? isBillOwner(p1, ebillName);
  if (p1Owner === null) return { kind: "ask_owner" };
  const e1 = eligibility(p1, today);
  if (e1.needDob) return { kind: "need_dob", who: "p1" };

  if (p1Owner) {
    if (e1.eligible) return { kind: "single", applicant: "p1", dropP1: false };
    // Owner can't apply → owner is co-applicant; p2 must be an eligible applicant.
    const reason = `owner_${e1.reason}` as CoappReason;
    if (!p2) return { kind: "need_p2", p2Role: "applicant", reason };
    const e2 = eligibility(p2, today);
    if (e2.needDob) return { kind: "need_dob", who: "p2" };
    if (e2.eligible) return { kind: "pair", applicant: "p2", coapp: "p1", reason };
    return { kind: "need_new_applicant", replace: "p2", reason: e2.reason as IneligibleReason };
  }

  // p1 isn't the bill owner → the owner's documents are mandatory as p2.
  if (!p2) return { kind: "need_p2", p2Role: "owner", reason: "bill_other_name" };
  if (isBillOwner(p2, ebillName) === false) return { kind: "p2_not_owner" };
  if (e1.eligible) return { kind: "pair", applicant: "p1", coapp: "p2", reason: "bill_other_name" };
  const e2 = eligibility(p2, today);
  if (e2.needDob) return { kind: "need_dob", who: "p2" };
  if (e2.eligible) return { kind: "single", applicant: "p2", dropP1: true };
  // Neither can apply → replace p1 with a new applicant; the owner stays as co-applicant.
  return { kind: "need_new_applicant", replace: "p1", reason: e1.reason as IneligibleReason };
}

export function coappReasonText(r: CoappReason): string {
  return COAPP_REASON_TEXT[r];
}
