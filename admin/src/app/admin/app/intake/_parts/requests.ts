// Intake chat · the calls to the application's own routes
// (/api/admin/loan-app/<id>/<route>) whose reply the chat reads: one request
// each; the reply's JSON when it succeeded, else the route's error (or `fail`).

import { authHeaders } from "@/lib/auth";

type Reply = { ok: true; data: any } | { ok: false; error: string };

async function call(url: string, init: RequestInit, fail: string): Promise<Reply> {
  const res = await fetch(url, init);
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j?.ok) return { ok: false, error: j?.error || fail };
  return { ok: true, data: j };
}

/** Sends a form (files / fields) to one of the application's routes. */
export function postLoanForm(appId: string | null, route: string, fd: FormData, fail: string): Promise<Reply> {
  return call(`/api/admin/loan-app/${appId}/${route}`, { method: "POST", headers: authHeaders(), body: fd }, fail);
}

/** Sends JSON to one of the application's routes (POST, or PATCH). */
export function sendLoanJson(appId: string | null, route: string, body: unknown, fail: string, method: "POST" | "PATCH" = "POST"): Promise<Reply> {
  return call(`/api/admin/loan-app/${appId}/${route}`, {
    method,
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  }, fail);
}
