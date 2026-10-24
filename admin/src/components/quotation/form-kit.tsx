"use client";

// Shared pieces of the quotation forms — the Quotation builder page (GES, Bijlee)
// and Customer applications (gozerobils).

import { useCallback, useEffect, useRef, useState } from "react";
import { getToken } from "@/lib/auth";

export const NAVY = "#1e3a8a";
export const input = "w-full border border-line rounded-xl px-3 py-2 text-[13.5px] outline-none focus:border-[#1e3a8a]";
export const inr = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-IN") : "0");
export const decimal = (v: string) => v.replace(/[^\d.]/g, "");
export const digits = (v: string) => v.replace(/\D/g, "");

// Keyboard navigation: Enter / ↓ / → (at caret end) → next field; ↑ / ← (at
// caret start) → previous. Works alongside mouse. Native <select> keeps ↑/↓ for
// its options; custom dropdowns (buttons) handle their own keys.
export function useKeyNav() {
  const formRef = useRef<HTMLDivElement>(null);
  function fieldList(): HTMLElement[] {
    const root = formRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>("input:not([type=file]), select, textarea, [data-qnav]"))
      .filter((el) => !(el as HTMLInputElement).disabled && el.offsetParent !== null);
  }
  function moveFocus(from: HTMLElement, dir: 1 | -1) {
    const list = fieldList();
    const i = list.indexOf(from);
    if (i < 0) return;
    const to = list[i + dir];
    if (!to) return;
    to.focus();
    const inp = to as HTMLInputElement;
    if (typeof inp.select === "function") { try { inp.select(); } catch { /* not selectable */ } }
  }
  function onFormKey(e: React.KeyboardEvent) {
    const t = e.target as HTMLElement;
    const tag = t.tagName;
    // Custom dropdown trigger (SearchableSelect): ↓/Enter/Space open it (the
    // component handles that); ↑/←/→ just navigate past it.
    if (t.hasAttribute("data-qnav")) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") return;
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); moveFocus(t, -1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); moveFocus(t, 1); }
      return;
    }
    if (tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") return;
    const el = t as HTMLInputElement;
    const isText = tag === "INPUT" || tag === "TEXTAREA";
    const len = el.value ? el.value.length : 0;
    const atEnd = isText ? (el.selectionStart ?? len) >= len : true;
    const atStart = isText ? (el.selectionStart ?? 0) === 0 : true;
    switch (e.key) {
      case "Enter": e.preventDefault(); moveFocus(t, 1); break;
      case "ArrowDown": if (tag === "SELECT") break; e.preventDefault(); moveFocus(t, 1); break;
      case "ArrowUp": if (tag === "SELECT") break; e.preventDefault(); moveFocus(t, -1); break;
      case "ArrowRight": if (tag === "SELECT" || (isText && !atEnd)) break; e.preventDefault(); moveFocus(t, 1); break;
      case "ArrowLeft": if (tag === "SELECT" || (isText && !atStart)) break; e.preventDefault(); moveFocus(t, -1); break;
    }
  }
  return { formRef, onFormKey };
}

// Custom dropdown values, read once per page load (forms open many times) and
// kept current as values are added (SearchableSelect → rememberBrandOption).
let brandOptions: Promise<Record<string, string[]>> | null = null;
const added: Record<string, string[]> = {};

export function rememberBrandOption(field: string, value: string) {
  (added[field] ??= []).push(value);
}

// Default option lists + the custom values saved from the dropdowns.
export function useBrandOptions() {
  const [custom, setCustom] = useState<Record<string, string[]>>({});
  useEffect(() => {
    brandOptions ??= fetch("/api/epc/quotation/brands", { headers: { Authorization: `Bearer ${getToken() ?? ""}` } })
      .then((res) => res.json())
      .then((j) => { if (!j?.ok) throw new Error(); return j.options as Record<string, string[]>; })
      .catch(() => { brandOptions = null; return {}; }); // defaults only; retried on the next form
    void brandOptions.then(setCustom);
  }, []);
  return useCallback(
    (base: string[], field: string) => Array.from(new Set([...base, ...(custom[field] || []), ...(added[field] || [])])),
    [custom],
  );
}

export function saveUrl(url: string, name: string) {
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

// Save the file the server sent back.
export async function saveDownload(res: Response) {
  const cd = res.headers.get("Content-Disposition") || "";
  const url = URL.createObjectURL(await res.blob());
  saveUrl(url, (cd.match(/filename="([^"]+)"/) || [])[1] || "quotation.pdf");
  URL.revokeObjectURL(url);
}

// POST /api/epc/quotation and save the file; resolves to the response's
// next suggested serial no. Throws a readable message on failure.
export async function downloadQuotation(body: object): Promise<string | null> {
  const res = await fetch("/api/epc/quotation", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || "Couldn't generate the document."); }
  const next = res.headers.get("X-Next-Serial");
  await saveDownload(res);
  return next;
}

export function Toggle({ on, onClick, label, grow }: { on: boolean; onClick: () => void; label: string; grow?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={[grow ? "flex-1" : "", "px-3 py-2 rounded-xl text-[13px] font-semibold border", on ? "text-white border-transparent" : "bg-white border-line text-text-mid"].join(" ")}
      style={on ? { background: NAVY } : undefined}>{label}</button>
  );
}

export function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex gap-2">
      {([["Yes", true], ["No", false]] as const).map(([lab, val]) => (
        <Toggle key={lab} label={lab} on={value === val} onClick={() => onChange(val)} grow />
      ))}
    </div>
  );
}

// Pick any number of options (none = not applicable).
export function Chips({ options, value, onChange }: { options: readonly string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((o) => (
        <Toggle key={o} label={o} on={value.includes(o)} onClick={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])} />
      ))}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-line p-5 mt-5">
      <div className="text-[13px] font-semibold text-[#0f3d2e] mb-3">{title}</div>
      <div className="grid sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

export function Field({ l, req, children }: { l: string; req?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12.5px] font-medium text-text-mid">{l}{req && <span className="text-red-500"> *</span>}</span>
      {children}
    </div>
  );
}
