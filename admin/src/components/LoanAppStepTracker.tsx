"use client";

// Loan application step tracker card.
//
// Reusable across all Steps 2-6. Renders:
//   - Application ID (display or fallback to short uuid)
//   - Customer/EPC name
//   - Created date
//   - "Step X of 6 · N% Complete" summary
//   - Horizontal visual tracker: circles with connecting lines,
//     current step highlighted in brand green.
//
// The 6 steps (indices 1-6):
//   1  Registration
//   2  KYC Verification
//   3  Personal Details
//   4  Employment & Income
//   5  Property & Loan
//   6  Review & Submit
//
// currentStep is 1-based. Steps below currentStep render as "done"
// (green), the currentStep renders as "active" (green ring + fill),
// steps above render as "pending" (grey).

type Props = {
  applicationId: string;
  displayId?: string | null;
  name: string;
  createdAt?: string | Date | null;
  currentStep: number;
  totalSteps?: number;
};

const STEP_LABELS = [
  "Registration",
  "KYC Verification",
  "Personal Details",
  "Employment & Income",
  "Loan",
  "Review & Submit",
];

export default function LoanAppStepTracker({
  applicationId,
  displayId,
  name,
  createdAt,
  currentStep,
  totalSteps = 6,
}: Props) {
  const total = Math.max(1, totalSteps);
  const clamped = Math.min(Math.max(currentStep, 1), total);
  const pct = Math.round(((clamped - 1) / total) * 100);
  const shownId = displayId || applicationId.slice(0, 8);
  const createdLabel = createdAt
    ? new Date(createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : null;

  return (
    <div className="rounded-card border border-line bg-white p-5 sm:p-6">
      {/* Top row — meta */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold">Application</p>
          <p className="font-mono text-[13px] font-semibold text-text truncate">{shownId}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold">Customer</p>
          <p className="text-[14px] font-semibold text-text truncate">{name || "—"}</p>
        </div>
        {createdLabel && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold">Created</p>
            <p className="text-[13px] text-text">{createdLabel}</p>
          </div>
        )}
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold">Progress</p>
          <p className="text-[14px] font-semibold text-[#178a5c]">
            Step {clamped} of {total} · {pct}% Complete
          </p>
        </div>
      </div>

      {/* Divider */}
      <div className="mt-5 mb-5 h-px bg-line" />

      {/* Tracker row */}
      <ol className="flex items-start gap-1">
        {Array.from({ length: total }, (_, i) => {
          const stepNum = i + 1;
          const state: "done" | "active" | "pending" =
            stepNum < clamped ? "done" :
            stepNum === clamped ? "active" : "pending";
          const label = STEP_LABELS[i] ?? `Step ${stepNum}`;
          return (
            <li key={stepNum} className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <StepCircle state={state} num={stepNum} />
                {stepNum < total && <ConnectorLine done={state === "done"} />}
              </div>
              <p
                className={[
                  "mt-1.5 text-[11px] leading-tight",
                  state === "active" ? "text-[#0f3d2e] font-semibold" :
                  state === "done"   ? "text-[#178a5c]" :
                                       "text-text-muted",
                ].join(" ")}
              >
                {label}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StepCircle({ state, num }: { state: "done" | "active" | "pending"; num: number }) {
  const base = "w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold border-2 shrink-0";
  if (state === "done") {
    return (
      <span className={base + " bg-[#178a5c] border-[#178a5c] text-white"}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className={base + " bg-white border-[#178a5c] text-[#0f3d2e] ring-4 ring-[#f0faf5]"}>
        {num}
      </span>
    );
  }
  return (
    <span className={base + " bg-white border-line text-text-muted"}>
      {num}
    </span>
  );
}

function ConnectorLine({ done }: { done: boolean }) {
  return (
    <span
      className={[
        "flex-1 h-0.5 rounded-full",
        done ? "bg-[#178a5c]" : "bg-line",
      ].join(" ")}
      aria-hidden
    />
  );
}
