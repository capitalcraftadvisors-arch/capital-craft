"use client";

import { SelectHTMLAttributes, forwardRef } from "react";

type Option = { value: string; label: string };

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  hint?: string;
  error?: string;
  options: Option[];
  placeholder?: string;
};

const Select = forwardRef<HTMLSelectElement, Props>(function Select(
  { label, hint, error, options, placeholder, className = "", id, ...rest },
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
      <select
        id={inputId}
        ref={ref}
        className={[
          "w-full rounded-input border bg-white px-3.5 py-3 text-[15px] text-text",
          "outline-none transition-colors duration-250 appearance-none",
          "bg-[url('data:image/svg+xml;utf8,<svg fill=%22%236B8294%22 viewBox=%220 0 20 20%22 xmlns=%22http://www.w3.org/2000/svg%22><path d=%22M5 8l5 5 5-5z%22/></svg>')] bg-no-repeat bg-[length:20px] bg-[right_12px_center] pr-9",
          error ? "border-red-500 focus:border-red-500" : "border-line focus:border-blue",
          className,
        ].join(" ")}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {error ? (
        <p className="mt-1.5 text-[12px] text-red-500">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[12px] text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
});

export default Select;
