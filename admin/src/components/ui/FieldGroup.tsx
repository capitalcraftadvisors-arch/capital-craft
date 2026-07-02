"use client";

// FieldGroup — a titled, highlighted container that groups a document
// upload with the fields that OCR fills from it. Used on Step 2 to bundle
// the PAN card upload + PAN number, and the GST doc upload + Legal name +
// Trade name + GSTIN. Gives EPCs a clearer visual anchor than a flat list.

import { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  leftIcon?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
};

export default function FieldGroup({
  title, subtitle, leftIcon, required, children, className = "",
}: Props) {
  return (
    <section
      className={[
        "rounded-input border-2 border-blue/25 bg-blue-50/40",
        "p-5 sm:p-6",
        className,
      ].join(" ")}
    >
      <header className="mb-4 flex items-start gap-3">
        {leftIcon && (
          <span className="text-blue-dark shrink-0 mt-0.5">{leftIcon}</span>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-semibold text-[15px] text-text">
            {title}
            {required && <span className="text-red-500 ml-1">*</span>}
          </h3>
          {subtitle && (
            <p className="text-[12px] text-text-mid mt-0.5">{subtitle}</p>
          )}
        </div>
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
