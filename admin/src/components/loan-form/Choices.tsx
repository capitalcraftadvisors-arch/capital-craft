"use client";

// Clickable choice cards with a round "selected" dot in the top-right corner —
// solar system type, residential/commercial, employment type, statement source.

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
        active ? "border-cc-green" : "border-line",
      ].join(" ")}
      aria-hidden
    >
      {active && <span className="w-2 h-2 rounded-full bg-cc-green" />}
    </span>
  );
}

/** One choice card: title + one-line description. */
export function ChoiceTile({
  active, onClick, title, desc, fadeDot,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  fadeDot?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "text-left rounded-input border-2 p-4 transition-colors relative",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-cc-blue",
        active
          ? "border-cc-green bg-cc-wash"
          : "border-line bg-white hover:border-cc-blue",
      ].join(" ")}
    >
      <RadioDot active={active} fade={fadeDot} />
      <p className={"font-display font-semibold text-[14px] pr-6 " + (active ? "text-cc-ink" : "text-text")}>
        {title}
      </p>
      <p className="text-[12px] text-text-muted mt-1">{desc}</p>
    </button>
  );
}

/** On-grid / off-grid / hybrid, three cards in a row. */
export function SystemChoice({
  value, onPick,
}: {
  value: string;
  onPick: (v: SystemType) => void;
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
          fadeDot
        />
      ))}
    </div>
  );
}

/** "Is the solar plant for Residential or Commercial use?" + its two cards.
 *  `className` is the wrapper's classes (e.g. a divider above it). */
export function PlantUseChoice({
  value, onPick, className,
}: {
  value: string;
  onPick: (v: PlantUse) => void;
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
          />
        ))}
      </div>
    </div>
  );
}
