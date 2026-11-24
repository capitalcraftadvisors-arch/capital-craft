// The server calls the loan-form pages make, written once. Each is exactly one
// request (no retries, no refetching).

import { useState } from "react";
import { authHeaders } from "@/lib/auth";
import { PINCODE_RE } from "@/lib/validators";

/** Saves one step: POST /api/admin/loan-app/<id>/complete-step-<n> with `body`.
 *  Returns null when saved, else the error text to show. Throws only on a network error. */
export async function saveStep(appId: string, step: number, body: object): Promise<string | null> {
  const res = await fetch(`/api/admin/loan-app/${appId}/complete-step-${step}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) return data?.error || `Save failed (HTTP ${res.status}).`;
  return null;
}

/** Sends files (and any text fields) as a form to one of the application's OCR
 *  routes, e.g. "extract-loan-docs". Returns the route's JSON, or the error text
 *  to show ("<failText> (HTTP 500)." when the route gave none). Throws only on a network error. */
export async function postLoanFiles(
  appId: string,
  route: string,
  fields: Record<string, string | Blob>,
  failText = "Upload failed",
): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(`/api/admin/loan-app/${appId}/${route}`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) return { ok: false, error: data?.error || `${failText} (HTTP ${res.status}).` };
  return { ok: true, data };
}

const PIN_FAILED = "Lookup failed — enter state manually.";

/** Looks up a 6-digit pincode → its state, district and city, or the error text to show. Never throws. */
export async function fetchPincode(
  pin: string,
): Promise<{ ok: true; state: string; district: string; city: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/admin/pincode-lookup?pin=${pin}`, {
      headers: authHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) return { ok: false, error: data?.error || PIN_FAILED };
    return { ok: true, state: String(data.state ?? ""), district: String(data.district ?? ""), city: String(data.city ?? "") };
  } catch {
    return { ok: false, error: PIN_FAILED };
  }
}

/** The installation pincode and the state / district / city it fills: `lookup`
 *  (on the Pincode box's blur) makes the one request for a full 6-digit pincode.
 *  `locked` = the state came from a successful lookup. */
export function usePincode() {
  const [pin, setPin]           = useState("");
  const [state, setState]       = useState("");
  const [district, setDistrict] = useState("");
  const [city, setCity]         = useState("");
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [locked, setLocked]     = useState(false);

  async function lookup(next: string) {
    setError(null);
    setLocked(false);
    if (!PINCODE_RE.test(next)) return;
    setBusy(true);
    const r = await fetchPincode(next);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setState(r.state);
    setDistrict(r.district);
    setCity(r.city);
    setLocked(true);
  }

  return { pin, setPin, state, setState, district, setDistrict, city, setCity, busy, error, locked, lookup };
}
export type Pincode = ReturnType<typeof usePincode>;

/** Where a step goes after saving: back to the Step-6 review when it was opened
 *  from there (?from=review), otherwise `next` (e.g. "step-4"). */
export function nextStepPath(appId: string, next: string): string {
  const fromReview = new URLSearchParams(window.location.search).get("from") === "review";
  return `/admin/app/${appId}/${fromReview ? "step-6" : next}`;
}
