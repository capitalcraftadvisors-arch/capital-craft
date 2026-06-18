import type { Config } from "tailwindcss";

// Tokens copied verbatim from the marketing site (www.capitalcraft.in / index.html).
// Anything new in the app must use these — no hex inventions.

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
