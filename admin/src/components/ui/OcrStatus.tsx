"use client";

// OcrStatus — consistent inline feedback pill for OCR flows.
// Four states:
//   reading  → neutral blue tint + spinner-ish dot
//   success  → green tint + check
//   warn     → amber tint + info glyph (e.g. "we read the doc but couldn't find the number")
//   error    → red tint + cross (e.g. "OCR failed — please type it in")
//
// Compact so it fits under a FileUpload without dominating the form.

import { ReactNode } from "react";

type State = "reading" | "success" | "warn" | "error";

const STYLE: Record<State, { bg: string; border: string; text: string; dot: string }> = {
  reading: { bg: "bg-blue-50",  border: "border-blue/20",  text: "text-blue-dark",  dot: "bg-blue animate-pulse" },
  success: { bg: "bg-green-50", border: "border-green/30", text: "text-green-800",  dot: "bg-green-600" },
  warn:    { bg: "bg-amber-50", border: "border-amber-300", text: "text-amber-900", dot: "bg-amber-500" },
  error:   { bg: "bg-red-50",   border: "border-red-200",  text: "text-red-700",   dot: "bg-red-500" },
};

export default function OcrStatus({
  state, children,
}: {
  state: State;
  children: ReactNode;
}) {
  const s = STYLE[state];
  return (
    <div
      className={[
        "mt-3 px-3.5 py-2.5 rounded-input border text-[12px] flex items-start gap-2.5",
        s.bg, s.border, s.text,
      ].join(" ")}
      role="status"
    >
      <span className={["mt-1 h-2 w-2 rounded-full shrink-0", s.dot].join(" ")} />
      <span className="leading-relaxed">{children}</span>
    </div>
  );
}
