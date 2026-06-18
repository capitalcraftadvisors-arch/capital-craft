import { FUNCTIONS_URL } from "./supabase";

// Shape returned by the `auth` Edge Function.
export type Business = {
  id: string;
  status: "draft" | "under_review" | "approved" | "on_hold" | "rejected";
  business_type:
    | "proprietorship"
    | "pvt_ltd"
    | "partnership"
    | "llp"
    | "admin"
    | null;
  current_step: number;
  contact_name: string | null;
};

const TOKEN_KEY = "cc_token";
const BUSINESS_KEY = "cc_business";

export async function login(mobile: string, otp: string): Promise<{ ok: true; business: Business } | { ok: false; error: string }> {
  const res = await fetch(`${FUNCTIONS_URL}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile, otp }),
  });
  const data = await res.json();
  if (!data.ok) return { ok: false, error: data.error || "login_failed" };
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(BUSINESS_KEY, JSON.stringify(data.business));
  return { ok: true, business: data.business };
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(BUSINESS_KEY);
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getBusiness(): Business | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(BUSINESS_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as Business; } catch { return null; }
}

export function setBusiness(b: Business) {
  localStorage.setItem(BUSINESS_KEY, JSON.stringify(b));
}

// Decides where a user should land after login (or on any page mount).
// Mirrors the routing logic in product-flows.md §2.1.
export function routeForBusiness(b: Business): string {
  if (b.business_type === "admin") return "/admin";
  if (b.status === "draft") return `/onboarding/step-${Math.max(1, Math.min(b.current_step || 1, 7))}`;
  if (b.status === "under_review" || b.status === "on_hold" || b.status === "rejected") return "/status";
  if (b.status === "approved") return "/dashboard";
  return "/login";
}
