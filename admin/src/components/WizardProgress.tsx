"use client";

type Step = { n: number; label: string; href: string };

const STEPS: Step[] = [
  { n: 1, label: "Personal",      href: "/onboarding/step-1" },
  { n: 2, label: "Business",      href: "/onboarding/step-2" },
  { n: 3, label: "Members",       href: "/onboarding/step-3" },
  { n: 4, label: "Bank",          href: "/onboarding/step-4" },
  { n: 5, label: "Office",        href: "/onboarding/step-5" },
  { n: 6, label: "References",    href: "/onboarding/step-6" },
];

export default function WizardProgress({ current }: { current: number }) {
  const pct = Math.min(100, Math.max(0, ((current - 1) / (STEPS.length - 1)) * 100));
  return (
    <div className="w-full">
      {/* Progress bar */}
      <div className="relative h-1.5 bg-line-soft rounded-full overflow-hidden">
        <div
          className="h-full bg-grad transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Numbered dots */}
      <ol className="mt-4 grid grid-cols-6 gap-2">
        {STEPS.map((s) => {
          const done = current > s.n;
          const active = current === s.n;
          return (
            <li key={s.n} className="flex flex-col items-center text-center">
              <div
                className={[
                  "w-7 h-7 rounded-full grid place-items-center text-[12px] font-bold transition-all duration-250",
                  done ? "bg-green text-white" : active ? "bg-blue text-white shadow-blue" : "bg-line-soft text-text-muted",
                ].join(" ")}
              >
                {done ? "✓" : s.n}
              </div>
              <span
                className={[
                  "mt-1 text-[11px] sm:text-[12px] font-medium",
                  active ? "text-text" : "text-text-muted",
                ].join(" ")}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
