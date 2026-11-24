"use client";

// Clickable choice cards with a round "selected" dot in the top-right corner —
// solar system type, residential/commercial, employment type, statement source.
// The partner's registration page draws them a little smaller (`compact`).

export const SYSTEM_OPTIONS = [
  { value: "on_grid",  title: "On-Grid Solar System",  desc: "Connected to electricity grid, can sell excess power" },
  { value: "off_grid", title: "Off-Grid Solar System", desc: "Independent system with battery storage" },
  { value: "hybrid",   title: "Hybrid Solar System",   desc: "Connected to the grid with battery storage" },
] as const;
type SystemType = (typeof SYSTEM_OPTIONS)[number]["value"];

const PLANT_USE_OPTIONS = [
  { value: "residential", label: "Residential", desc: "Home / housing society rooftop" },
  { value: "commercial",  label: "Commercial",  desc: "Shop, office, factory, or institution" },
] as const;
type PlantUse = (typeof PLANT_USE_OPTIONS)[number]["value"];

/** The round dot; `fade` animates its border colour when it changes. */
export function RadioDot({ active, fade }: { active: boolean; fade?: boolean }) {
  return (
    <span
      className={[
        "absolute top-3 right-3 w-4 h-4 rounded-full border-2 flex items-center justify-center" + (fade ? " transition-colors" : ""),
        active ? "border-[#178a5c]" : "border-line",
      ].join(" ")}
      aria-hidden
    >
      {active && <span className="w-2 h-2 rounded-full bg-[#178a5c]" />}
    </span>
  );
}

/** One choice card: title + one-line description. `compact` = smaller text and
 *  no keyboard-focus ring (the partner page). */
export function ChoiceTile({
  active, onClick, title, desc, fadeDot, compact,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  fadeDot?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "text-left rounded-input border-2 p-4 transition-colors relative",
        ...(compact ? [] : ["focus:outline-none focus-visible:ring-2 focus-visible:ring-[#185fa5]"]),
        active
          ? "border-[#178a5c] bg-[#f0faf5]"
          : "border-line bg-white hover:border-[#185fa5]",
      ].join(" ")}
    >
      <RadioDot active={active} fade={fadeDot} />
      <p className={`font-display font-semibold ${compact ? "text-[13px]" : "text-[14px]"} pr-6 ` + (active ? "text-[#0f3d2e]" : "text-text")}>
        {title}
      </p>
      <p className={`${compact ? "text-[11px]" : "text-[12px]"} text-text-muted mt-1`}>{desc}</p>
    </button>
  );
}

/** On-grid / off-grid / hybrid, three cards in a row. */
export function SystemChoice({
  value, onPick, compact,
}: {
  value: string;
  onPick: (v: SystemType) => void;
  compact?: boolean;
}) {
  return (
    <div className="grid sm:grid-cols-3 gap-3">
      {SYSTEM_OPTIONS.map((opt) => (
        <ChoiceTile
          key={opt.value}
          active={value === opt.value}
          onClick={() => onPick(opt.value)}
          title={opt.title}
          desc={opt.desc}
          fadeDot={!compact}
          compact={compact}
        />
      ))}
    </div>
  );
}

/** "Is the solar plant for Residential or Commercial use?" + its two cards.
 *  `className` is the wrapper's classes (e.g. a divider above it). */
export function PlantUseChoice({
  value, onPick, compact, className,
}: {
  value: string;
  onPick: (v: PlantUse) => void;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="block mb-2 text-[13px] font-medium text-text-mid">
        Is the solar plant for Residential or Commercial use?
      </p>
      <div className="grid grid-cols-2 gap-3 max-w-[420px]">
        {PLANT_USE_OPTIONS.map((opt) => (
          <ChoiceTile
            key={opt.value}
            active={value === opt.value}
            onClick={() => onPick(opt.value)}
            title={opt.label}
            desc={opt.desc}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}
