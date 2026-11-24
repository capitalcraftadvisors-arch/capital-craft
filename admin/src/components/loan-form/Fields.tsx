"use client";

// Small building blocks used inside the loan-form pages (team steps 1-6). Each
// one is plain markup with its exact classes, so a page reads the same as
// before — just shorter.

import type { ReactNode } from "react";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import type { Pincode } from "./requests";

/** Section heading styles: plain 16px, green 16px, and the larger green 18px. */
const H16 = "font-display font-semibold text-[16px]";
export const H16_GREEN = "font-display font-semibold text-[16px] text-[#0f3d2e]";
export const H18 = "font-display font-semibold text-[18px] text-[#0f3d2e]";

/** Same look as the label <Input> draws — for labels above custom controls. */
export const FIELD_LABEL = "block mb-1.5 text-[13px] font-medium text-text-mid";

/** A form card with an <h2> title. With `subtitle`, the title and a grey line
 *  under it are wrapped together (the larger sections use this). */
export function FormSection({
  title, subtitle, className = "p-6 space-y-4", titleClassName = H16, children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  className?: string;        // the Card's classes
  titleClassName?: string;
  children?: ReactNode;
}) {
  return (
    <Card className={className}>
      {subtitle !== undefined ? (
        <div>
          <h2 className={titleClassName}>{title}</h2>
          <p className="text-[13px] text-text-mid mt-1">{subtitle}</p>
        </div>
      ) : (
        <h2 className={titleClassName}>{title}</h2>
      )}
      {children}
    </Card>
  );
}

/** Red error box; renders nothing when there is no message. */
export function ErrorBox({
  message, roomy, className,
}: {
  message: string | null | undefined;
  roomy?: boolean;           // p-3.5 instead of p-3
  className?: string;        // extra classes, e.g. "mb-4"
}) {
  if (!message) return null;
  return (
    <div className={`${roomy ? "p-3.5" : "p-3"} rounded-input bg-red-50 border border-red-200 text-[13px] text-red-700${className ? " " + className : ""}`}>
      {message}
    </div>
  );
}

/** Small green capsule ("Uploaded", "Extracted" …). */
export function GreenPill({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#f0faf5] text-[#0f3d2e] font-semibold uppercase tracking-wide border border-[#cdeadd]">
      {children}
    </span>
  );
}

/** White tick in a green circle (24px; `small` = 20px). */
export function TickCircle({ small }: { small?: boolean }) {
  const icon = small ? "12" : "14";
  return (
    <span className={`${small ? "w-5 h-5" : "w-6 h-6"} rounded-full bg-[#178a5c] flex items-center justify-center`}>
      <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
}

/** The "View" eye icon. */
export function EyeIcon({ size }: { size: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** A checkbox with its sentence (consent / "I have reviewed …"). `className` is the row's classes. */
export function CheckRow({
  checked, onChange, className, children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className: string;
  children: ReactNode;
}) {
  return (
    <label className={className}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-[#178a5c]"
      />
      <span className="text-text">{children}</span>
    </label>
  );
}

/** One of the policy links in the consent sentence. */
export function PolicyLink({ children }: { children: ReactNode }) {
  return (
    <a href="#" target="_blank" rel="noopener" className="text-[#185fa5] hover:underline font-medium">
      {children}
    </a>
  );
}

/** The Pincode box (looks the state up when it loses focus) beside the State box. */
export function PincodeFields({
  p, pinPlaceholder, stateReadOnly, stateHint,
}: {
  p: Pincode;
  pinPlaceholder?: string;
  stateReadOnly?: boolean;
  stateHint: string;
}) {
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <Input
        label="Pincode (installation address)"
        inputMode="numeric"
        maxLength={6}
        value={p.pin}
        onChange={(e) => p.setPin(e.target.value.replace(/\D/g, ""))}
        onBlur={(e) => void p.lookup(e.target.value)}
        placeholder={pinPlaceholder}
        error={p.error ?? undefined}
        hint={p.busy ? "Looking up state…" : undefined}
      />
      <Input
        label="Installation state"
        value={p.state}
        onChange={(e) => p.setState(e.target.value)}
        readOnly={stateReadOnly}
        placeholder={p.busy ? "Fetching…" : "State"}
        hint={stateHint}
      />
    </div>
  );
}

/** Full-width (both grid columns) labelled 3-row text box — used for addresses. */
export function TextAreaField({
  label, value, onChange, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="sm:col-span-2">
      <label className={FIELD_LABEL}>
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full rounded-input border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-blue resize-y"
      />
    </div>
  );
}
