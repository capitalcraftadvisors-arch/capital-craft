"use client";

import { InputHTMLAttributes, forwardRef, ReactNode } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
  leftIcon?: ReactNode;
  /** Clickable control inside the right edge (e.g. a show-password eye). */
  rightSlot?: ReactNode;
};

const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, hint, error, className = "", id, leftIcon, rightSlot, ...rest },
  ref,
) {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block mb-1.5 text-[13px] font-medium text-text-mid">
          {label}
        </label>
      )}
      <div className="relative">
        {leftIcon && (
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-text-muted">
            {leftIcon}
          </span>
        )}
        <input
          id={inputId}
          ref={ref}
          className={[
            "w-full rounded-input border bg-white py-3 text-[15px] text-text",
            leftIcon ? "pl-10" : "pl-3.5",
            rightSlot ? "pr-11" : "pr-3.5",
            "placeholder:text-text-muted",
            "outline-none transition-colors duration-250",
            error
              ? "border-red-500 focus:border-red-500"
              : "border-line focus:border-blue",
            className,
          ].join(" ")}
          {...rest}
        />
        {rightSlot && (
          <span className="absolute inset-y-0 right-0 flex items-center pr-2">{rightSlot}</span>
        )}
      </div>
      {error ? (
        <p className="mt-1.5 text-[12px] text-red-500">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[12px] text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
});

export default Input;
