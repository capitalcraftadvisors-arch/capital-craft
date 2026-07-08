"use client";

// 3-step tracker for the EPC-facing loan apply flow
// (Registration → Documents → Project & Loan).

export default function EpcApplyTracker({ step }: { step: 1 | 2 | 3 }) {
  const labels = ["Registration", "Documents", "Project & Loan"];
  return (
    <ol className="flex items-center gap-2">
      {labels.map((label, i) => {
        const n = i + 1;
        const stateCls =
          n < step ? "bg-[#178a5c] border-[#178a5c] text-white" :
          n === step ? "bg-white border-[#178a5c] text-[#0f3d2e] ring-4 ring-[#f0faf5]" :
          "bg-white border-line text-text-muted";
        return (
          <li key={label} className="flex items-center gap-2 flex-1 min-w-0">
            <span className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[12px] font-bold shrink-0 ${stateCls}`}>
              {n < step ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              ) : n}
            </span>
            <span className={"text-[12px] truncate " + (n === step ? "font-semibold text-[#0f3d2e]" : "text-text-muted")}>
              {label}
            </span>
            {n < 3 && <span className={"flex-1 h-0.5 rounded-full " + (n < step ? "bg-[#178a5c]" : "bg-line")} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
