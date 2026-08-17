"use client";

// One-time login welcome. Fires right after a login (auth.ts sets "cc_greet"
// on every successful login), shows a ~1s animated figure doing namaste, then
// auto-dismisses. Click / Enter / Esc dismiss instantly as a fallback.

import { useEffect, useState } from "react";
import { getBusiness, greetingName } from "@/lib/auth";

export default function NamasteGreeting() {
  const [phase, setPhase] = useState<"hidden" | "in" | "out">("hidden");
  const [name, setName] = useState("");

  // 1) Decide whether to show — once, right after a login.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem("cc_greet") !== "1") return;
    sessionStorage.removeItem("cc_greet");
    const label = greetingName(getBusiness());
    setName(label === "there" ? "" : label);
    setPhase("in");
  }, []);

  // 2) Drive the timeline off `phase` (not the consumed flag) so React 18
  //    StrictMode's effect double-run can't strand it on screen.
  useEffect(() => {
    if (phase !== "in") return;
    const t1 = setTimeout(() => setPhase("out"), 1000);
    const t2 = setTimeout(() => setPhase("hidden"), 1450);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === "Escape") setPhase("hidden"); };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener("keydown", onKey); };
  }, [phase]);

  if (phase === "hidden") return null;

  return (
    <div className={"namaste-overlay " + (phase === "out" ? "is-out" : "is-in")} onClick={() => setPhase("hidden")}>
      <div className="namaste-inner">
        <div className="namaste-figure" aria-hidden>
          <svg viewBox="0 0 160 180" width="140" height="158" fill="none">
            <defs>
              <linearGradient id="figg" x1="20" y1="10" x2="150" y2="175" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#16a34a" /><stop offset=".5" stopColor="#0f766e" /><stop offset="1" stopColor="#185fa5" />
              </linearGradient>
              <radialGradient id="figglow" cx="50%" cy="40%" r="60%">
                <stop offset="0" stopColor="#16a34a" stopOpacity=".18" /><stop offset="1" stopColor="#16a34a" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="80" cy="80" r="78" fill="url(#figglow)" />
            <ellipse cx="80" cy="168" rx="34" ry="6" fill="#0f3d2e" opacity=".08" />
            <g className="fig-bow">
              {/* head */}
              <circle cx="80" cy="40" r="18" fill="url(#figg)" />
              {/* torso / kurta */}
              <path d="M52 168 C 49 118 56 80 80 80 C 104 80 111 118 108 168 Z" fill="url(#figg)" />
              {/* folded palms at the chest */}
              <path d="M80 70 C 75 80 71 90 71 97 C 71 103 75 107 80 107 C 85 107 89 103 89 97 C 89 90 85 80 80 70 Z" fill="#eafaf2" />
              <path d="M80 76 L80 105" stroke="#0f766e" strokeOpacity=".45" strokeWidth="1.6" strokeLinecap="round" />
              {/* arms bringing the hands together */}
              <path d="M56 116 C 50 96 60 84 72 88" stroke="url(#figg)" strokeWidth="11" fill="none" strokeLinecap="round" />
              <path d="M104 116 C 110 96 100 84 88 88" stroke="url(#figg)" strokeWidth="11" fill="none" strokeLinecap="round" />
            </g>
          </svg>
        </div>
        <div className="namaste-text">Namaste{name ? ", " + name : ""}</div>
      </div>
      <style jsx>{`
        .namaste-overlay {
          position: fixed; inset: 0; z-index: 60; cursor: pointer;
          display: grid; place-items: center;
          background: radial-gradient(900px 560px at 50% 42%, #eafaf2 0%, #ffffff 74%);
        }
        .namaste-overlay.is-in { animation: fadeIn .28s ease both; }
        .namaste-overlay.is-out { animation: fadeOut .45s ease both; }
        .namaste-inner { text-align: center; }
        .namaste-figure { display: inline-flex; animation: rise .5s cubic-bezier(.2,.9,.25,1.1) both; }
        .fig-bow { transform-box: fill-box; transform-origin: 80px 168px; animation: bow 1.3s ease-in-out both; }
        .namaste-text {
          margin-top: 6px;
          font-size: clamp(34px, 7vw, 74px);
          font-weight: 800; letter-spacing: -0.02em; line-height: 1.05;
          background: linear-gradient(100deg, #0f766e 0%, #16a34a 35%, #185fa5 70%, #16a34a 100%);
          background-size: 300% 100%;
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent; color: transparent;
          animation: shimmer 2s linear infinite, rise .5s .08s cubic-bezier(.2,.8,.2,1) both;
        }
        @keyframes bow { 0%{transform:rotate(0)} 34%{transform:rotate(7deg)} 62%{transform:rotate(7deg)} 100%{transform:rotate(0)} }
        @keyframes shimmer { to { background-position: 300% 0; } }
        @keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { .namaste-figure, .fig-bow, .namaste-text { animation: none; } }
      `}</style>
    </div>
  );
}
