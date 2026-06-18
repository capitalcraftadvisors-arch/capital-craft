"use client";

import { InputHTMLAttributes, forwardRef } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
};

const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, hint, error, className = "", id, ...rest },
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
      <input
        id={inputId}
        ref={ref}
        className={[
          "w-full rounded-input border bg-white px-3.5 py-3 text-[15px] text-text",
          "placeholder:text-text-muted",
          "outline-none transition-colors duration-250",
          error
            ? "border-red-500 focus:border-red-500"
            : "border-line focus:border-blue",
          className,
        ].join(" ")}
        {...rest}
      />
      {error ? (
        <p className="mt-1.5 text-[12px] text-red-500">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[12px] text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
});

export default Input;
