"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "outline" | "grad" | "ghost";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
  fullWidth?: boolean;
};

const base =
  "inline-flex items-center justify-center gap-2 px-[26px] py-[13px] rounded-btn " +
  "font-semibold text-[15px] cursor-pointer no-underline transition-all duration-250 " +
  "disabled:opacity-60 disabled:cursor-not-allowed font-sans";

const variants: Record<Variant, string> = {
  primary:
    "bg-blue text-white shadow-blue hover:bg-blue-dark hover:-translate-y-0.5 hover:shadow-blue-hover",
  outline:
    "bg-white text-text border-[1.5px] border-line hover:border-blue hover:text-blue hover:-translate-y-0.5",
  grad:
    "bg-grad text-white shadow-green hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-green-hover",
  ghost:
    "bg-transparent text-text-mid hover:text-text",
};

const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", loading, fullWidth, className = "", children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={[base, variants[variant], fullWidth ? "w-full" : "", className].join(" ")}
      {...rest}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
});

export default Button;

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
