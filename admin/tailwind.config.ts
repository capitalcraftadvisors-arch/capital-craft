import type { Config } from "tailwindcss";

// Tokens copied verbatim from the marketing site (www.capitalcraft.in / index.html),
// plus the app's own palette (cc-*, navy-*, warn-*, danger-*, whatsapp, grey-* —
// see "App palette" below). Anything new in the app must use these — no hex inventions.

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        blue: {
          DEFAULT: "#0066FF",
          dark: "#0052CC",
          50: "#EBF3FF",
        },
        green: {
          DEFAULT: "#00B86B",
          dark: "#008F52",
          50: "#E6F8EF",
        },
        gold: {
          DEFAULT: "#F5B800",
          50: "#FFF5D6",
        },
        bg: {
          DEFAULT: "#FFFFFF",
          soft: "#F6FBFA",
          card: "#FFFFFF",
          tint: "#F0F7FF",
        },
        text: {
          DEFAULT: "#0A1F2E",
          mid: "#3D5566",
          muted: "#6B8294",
        },
        line: {
          DEFAULT: "#E3EDF2",
          soft: "#F0F4F7",
        },

        // ── App palette (cleanup step 8) ─────────────────────────────────────
        // Named versions of the hex classes the app had written out by hand
        // (text-[#0f3d2e] → text-cc-ink, bg-[#178a5c]/10 → bg-cc-green/10 …).
        // Each value is EXACTLY the old hex — same colour, same look. Use these
        // names in new code instead of writing the hex again. Rarely used hexes
        // (under 5 uses) are still written out where they are.
        //
        // Hexes that are exactly a stock Tailwind colour this config does not
        // change were switched to that name instead:
        //   #dc2626 → red-600   #b45309 → amber-700   #334155 → slate-700
        //   #9f1239 → rose-800  #0f766e → teal-700

        // Capital Craft greens — the team console (admin) palette; also in
        // shared parts (document views, chats, lender chips).
        cc: {
          ink: "#0f3d2e",             // dark green ink — headings, values, body text
          "ink-deep": "#0f2a20",      // near-black green — big KPI numbers (Team analytics)
          green: "#178a5c",           // THE green — buttons, links, ticks, active tabs, focus borders
          "green-hover": "#12734c",   // the green, darker — button hover
          "green-text": "#0f7a52",    // deeper green text — approved / ready chips, IDs
          muted: "#5a8a76",           // muted green-grey — labels, secondary text
          faint: "#7a958a",           // lighter grey-green — meta lines (name · time)
          hint: "#8ab3a1",            // pale green — idle icons, "not sent"
          empty: "#9aa5a0",           // grey — empty-state text ("No co-applicant", "Pending")
          blank: "#c3cbc7",           // light grey — a KPI with nothing yet ("—")
          line: "#cdeadd",            // soft-green border — inputs, cards, outline buttons
          "line-soft": "#e0f0e8",     // lighter border — cards, table header bands
          "row-line": "#eaf3ee",      // table row dividers
          "row-line-soft": "#f0f4f2", // greyer row dividers (Task Manager, analytics)
          rule: "#eef3f1",            // header / section bottom rule, thin progress tracks
          "tint-strong": "#d6efe3",   // stronger green fill — icon tiles, RFD chip
          tint: "#e6f6ee",            // green fill — success chips and notes
          wash: "#f0faf5",            // pale green fill — hovers, table headers, soft panels
          soft: "#f4fbf7",            // soft green fill — secondary buttons, panels
          "row-hover": "#f7fcfa",     // table row hover
          mist: "#f7fcf9",            // list row hover, attached-file fill
          "icon-hover": "#eef6f1",    // round icon-button hover
          chip: "#eef1f0",            // neutral grey-green chip — Draft, counts
          track: "#eef3f0",           // progress bar track (Team analytics)

          // The team console's blue — second colour (links, uploads, EPC onboarding chat)
          blue: "#185fa5",            // blue links, IDs, focus borders, outline buttons
          "blue-dark": "#124a82",     // blue button hover
          "blue-ink": "#0f3a66",      // dark blue ink — EPC onboarding chat header / text
          "blue-muted": "#5a86b3",    // muted blue text — upload hints
          "blue-line": "#d3e9f7",     // blue panel border
          "blue-tint": "#dceffb",     // blue info panel fill
          "blue-wash": "#f2f7fc",     // pale blue fill — upload boxes, outline-button hover
        },

        // Partner Portal navy — the pages EPCs use (dashboard, chats, login).
        navy: {
          DEFAULT: "#1e3a8a",         // THE navy — buttons, links, chat bubbles, selected borders
          hover: "#17307a",           // navy button hover
          ink: "#14235c",             // dark navy headings / text
          deep: "#0f1f4d",            // near-black navy — login page text
          line: "#c7d5f0",            // navy border — bot bubbles, file chips
          tint: "#e8effc",            // navy chip fill — counts, "Current"
          wash: "#eef3fc",            // soft navy fill — code chip, dashed-box hover
          soft: "#f4f7fd",            // palest navy fill — choice hover, file chip
          mist: "#f7f9fe",            // panel header band, row hover
        },

        // Warning amber — under review, on hold, notices.
        warn: {
          ink: "#854f0b",             // amber-brown text — warnings, "under review"
          ochre: "#8a6500",           // ochre text — "on hold" / "updated" chips
          line: "#f3d9a4",            // amber border
          tint: "#fef0d6",            // amber chip fill
          wash: "#fef8ee",            // pale amber panel
        },

        // Danger red (alongside stock red-*).
        danger: {
          ink: "#b42318",             // red text — declining trends, Task Manager alerts
          line: "#f2c4c4",            // soft red border — alert panels
        },

        // WhatsApp's own green — WhatsApp buttons and links.
        whatsapp: "#128c7e",

        // Cool greys (not Tailwind's `gray`).
        grey: {
          line: "#eef1f4",            // table row lines, bar tracks (analytics, Task Manager)
          pill: "#eef2f7",            // count pills (Task Manager tabs)
          chip: "#eef1f5",            // "off" / closed chips (Partner Portal)
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["'Space Grotesk'", "Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        btn: "12px",
        card: "18px",
        "card-lg": "22px",
        input: "10px",
      },
      boxShadow: {
        sm: "0 1px 3px rgba(10,31,46,0.04), 0 1px 2px rgba(10,31,46,0.06)",
        md: "0 4px 12px rgba(10,31,46,0.06), 0 2px 4px rgba(10,31,46,0.04)",
        lg: "0 12px 32px rgba(10,31,46,0.08), 0 4px 8px rgba(10,31,46,0.04)",
        blue: "0 12px 32px rgba(0,102,255,0.18)",
        "blue-hover": "0 16px 40px rgba(0,102,255,0.28)",
        green: "0 12px 32px rgba(0,184,107,0.18)",
        "green-hover": "0 16px 40px rgba(0,184,107,0.28)",
      },
      backgroundImage: {
        grad: "linear-gradient(90deg, #0066FF, #00B86B)",
      },
      maxWidth: {
        container: "1200px",
      },
      transitionDuration: {
        250: "250ms",
      },
    },
  },
  plugins: [],
};

export default config;
