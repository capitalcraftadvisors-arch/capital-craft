"use client";

// The full-screen welcome right after a login (LoginWelcome) — ~3.2 s, then it
// fades into the page underneath (a click skips it). A clean two-part card:
// the greeting on the left, the picture on the right.
//   team    — Capital Craft green: "Welcome back," + the name, the message; the team
//             photo that melts into the page (no frame)
//   partner — navy: its name and Capital Craft's joined by a handshake, "Welcome to"
//             + "Capital Craft!", the message, ☀ "Glad to have you on board!";
//             a rooftop solar photo that melts into the page (no frame)
// Top right: a "Team Portal" / "Partner Portal" badge; bottom left: a short
// hand-written line.

import { useEffect, useState, type ReactNode } from "react";

export type WelcomeTone = "team" | "partner";
const TONE: Record<WelcomeTone, { ink: string; accent: string; rule: string; dot: string }> = {
  team:    { ink: "#0f4d3a", accent: "#178a5c", rule: "#f5a623", dot: "#2fae7f" },
  partner: { ink: "#102b5c", accent: "#2455a4", rule: "#f5a623", dot: "#249c8a" },
};

export default function WelcomeScreen({ tone, badge, above, lead, name, message, chip, tagline, picture, onDone }: {
  tone: WelcomeTone;
  badge: string;           // "Team Portal" / "Partner Portal"
  above?: ReactNode;       // over the greeting (the partner's name 🤝 Capital Craft)
  lead: string;            // medium line ("Welcome back,")
  name: string;            // the big bold line ("Manish!")
  message: ReactNode;
  chip?: ReactNode;        // the card under the message (team / partner)
  tagline: string;         // the hand-written line
  picture: ReactNode;      // the right side (WelcomePhoto)
  onDone: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), 3200); // begin fade-out
    const t2 = setTimeout(onDone, 3650);                 // hand off
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);
  const t = TONE[tone];

  return (
    <div className={"ccw " + (leaving ? "ccw-out" : "")} role="dialog" aria-label={`${lead} ${name}`} onClick={() => setLeaving(true)}>
      <div className="ccw-left">
        <img src="/brand/capital-craft.png" alt="Capital Craft" className="ccw-logo" />
        <div className="ccw-copy">
          {above && <div className="ccw-above">{above}</div>}
          <p className="ccw-lead" style={{ color: t.ink }}>{lead}</p>
          <h1 className="ccw-name" style={{ color: t.ink }}>{name}</h1>
          <svg className="ccw-swoosh" viewBox="0 0 220 16" aria-hidden>
            <path d="M3 11 C 60 3, 140 2, 217 8" fill="none" stroke={t.rule} strokeWidth="4" strokeLinecap="round" />
          </svg>
          <p className="ccw-msg">{message}</p>
          {chip && <div className="ccw-chip">{chip}</div>}
        </div>
        <p className="ccw-tag" style={{ color: t.ink }}>
          {tagline}
          <svg viewBox="0 0 240 14" aria-hidden><path d="M4 9 C 70 2, 160 3, 236 7" fill="none" stroke={t.rule} strokeWidth="3" strokeLinecap="round" /></svg>
        </p>
      </div>

      <div className="ccw-right">{picture}</div>

      <span className="ccw-badge">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          {tone === "team"
            ? <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></>
            : <><path d="m11 17 2 2a1 1 0 1 0 3-3" /><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" /><path d="m21 3 1 11h-2" /><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" /><path d="M3 4h8" /></>}
        </svg>
        {badge}
        <i style={{ background: t.dot }} />
      </span>

      <style jsx>{`
        .ccw {
          position: fixed; inset: 0; z-index: 200; overflow: hidden; cursor: default;
          display: grid; grid-template-columns: 1fr 1fr;
          background: linear-gradient(180deg, #fbfcfe 0%, #f3f6fb 100%);
          font-family: Inter, system-ui, Arial, sans-serif;
          animation: ccw-in .4s ease both;
        }
        .ccw-out { animation: ccw-fade .45s ease forwards; }

        .ccw-left { position: relative; z-index: 1; display: flex; flex-direction: column; justify-content: center; padding: 0 clamp(28px, 6vw, 110px); }
        .ccw-above { margin-bottom: clamp(22px, 4.2vh, 40px); }
        .ccw-logo { position: absolute; top: clamp(26px, 5.5vh, 52px); left: clamp(28px, 6vw, 110px); height: clamp(34px, 4.8vh, 46px); width: auto; }
        .ccw-copy { animation: ccw-rise .7s .1s cubic-bezier(.2,.7,.2,1) both; }
        .ccw-lead { margin: 0; font-family: "Space Grotesk", Inter, sans-serif; font-size: clamp(30px, 3.4vw, 50px); font-weight: 600; letter-spacing: -.02em; line-height: 1.1; }
        .ccw-name {
          margin: 2px 0 0; font-family: "Space Grotesk", Inter, sans-serif; font-weight: 700;
          font-size: clamp(50px, 6.2vw, 92px); line-height: 1.02; letter-spacing: -.035em; word-break: break-word;
        }
        .ccw-swoosh { display: block; width: clamp(150px, 15vw, 230px); height: auto; margin: clamp(10px, 1.6vh, 18px) 0 0; }
        .ccw-msg { margin: clamp(18px, 3vh, 28px) 0 0; max-width: 500px; font-size: clamp(17px, 1.5vw, 21px); line-height: 1.55; color: #334155; }
        .ccw-chip {
          margin-top: clamp(22px, 3.8vh, 38px); display: inline-flex; max-width: 100%;
          padding: 16px 22px; border-radius: 20px; background: rgba(255,255,255,.92);
          border: 1px solid rgba(15, 23, 42, .06); box-shadow: 0 22px 44px -26px rgba(15, 23, 42, .40);
          animation: ccw-rise .7s .3s cubic-bezier(.2,.7,.2,1) both;
        }
        .ccw-tag {
          position: absolute; left: clamp(28px, 6vw, 110px); bottom: clamp(22px, 5vh, 50px); margin: 0;
          font-family: Satisfy, "Brush Script MT", cursive; font-size: clamp(24px, 2.4vw, 34px); line-height: 1;
          animation: ccw-rise .7s .45s ease both;
        }
        .ccw-tag svg { display: block; width: clamp(160px, 16vw, 240px); height: auto; margin-top: 6px; }

        /* no frame: edge to edge, reaching a little under the greeting (WelcomePhoto fades its left edge) */
        .ccw-right { position: relative; overflow: hidden; margin-left: calc(-1 * clamp(40px, 8vw, 160px)); }

        .ccw-badge {
          position: absolute; top: clamp(22px, 5vh, 48px); right: clamp(28px, 3.4vw, 56px); z-index: 3;
          display: inline-flex; align-items: center; gap: 8px; padding: 9px 14px 9px 13px; border-radius: 999px;
          font-size: 13.5px; font-weight: 600; color: #0f172a; background: rgba(255,255,255,.86);
          box-shadow: 0 10px 24px -14px rgba(15, 23, 42, .45); backdrop-filter: blur(6px);
        }
        .ccw-badge i { width: 7px; height: 7px; border-radius: 50%; }

        @keyframes ccw-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes ccw-fade { to { opacity: 0; transform: scale(1.01) } }
        @keyframes ccw-rise { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: none } }

        @media (max-width: 860px) {
          .ccw { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
          .ccw-left { padding: 104px 24px 20px; }
          .ccw-logo { left: 24px; }
          .ccw-tag { display: none; }
          .ccw-right { min-height: 40vh; margin-left: 0; }
          .ccw-badge { top: 30px; right: 20px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ccw, .ccw-copy, .ccw-chip, .ccw-tag { animation: ccw-in .3s ease both; }
        }
      `}</style>
    </div>
  );
}

/** The right-hand photo, frameless — it melts into the page on its left.
 *    team   — "whole": the FULL photo, all three people, never cropped or faded — as tall as the side
 *             allows, at the right; its wall colour carries on to the left and fades into the page.
 *             public/welcome/team.jpg (the Capital Craft team, from the user's card) — the main Admin
 *             man.jpg (Manish) / woman.jpg (Malvika) — the namaste photos, same way (the user's cards)
 *    solar  — "cover": rooftop solar filling the side, navy-toned, slow settle-in zoom.
 *             public/welcome/solar.jpg (Benjamin Jopen, Unsplash License) — EPC partners
 *  `fill` continues each photo's own left-edge background. */
export type WelcomePhotoKey = "team" | "man" | "woman" | "solar";
type Photo =
  | { fit: "whole"; src: string; w: number; h: number; fill: string }
  | { fit: "cover"; src: string; position: string; fill: string; wash: string };

const PHOTO: Record<WelcomePhotoKey, Photo> = {
  team: { fit: "whole", src: "/welcome/team.jpg", w: 1422, h: 1800, fill: "#f6ecf4" },
  man: { fit: "whole", src: "/welcome/man.jpg", w: 1220, h: 1356, fill: "linear-gradient(180deg, #f0f4e6 0%, #e9f0df 100%)" },
  woman: { fit: "whole", src: "/welcome/woman.jpg", w: 1240, h: 1476, fill: "#ede8fa" },
  solar: {
    fit: "cover", src: "/welcome/solar.jpg", position: "30% 50%", fill: "#102b5c",
    wash: "linear-gradient(180deg, rgba(16,43,92,.10) 0%, rgba(16,43,92,.20) 50%, rgba(16,43,92,.55) 100%)",
  },
};

export function WelcomePhoto({ photo }: { photo: WelcomePhotoKey }) {
  const p = PHOTO[photo];
  return (
    <div className={`ccwp ccwp-${p.fit}`} style={{ background: p.fill }}>
      {p.fit === "whole" ? (
        <div className="ccwp-frame" style={{ aspectRatio: `${p.w} / ${p.h}`, height: `min(100cqh, ${((p.h / p.w) * 100).toFixed(2)}cqw)` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.src} alt="" aria-hidden className="ccwp-img" />
        </div>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.src} alt="" aria-hidden className="ccwp-img" style={{ objectPosition: p.position }} />
          <span className="ccwp-wash" style={{ background: p.wash }} aria-hidden />
        </>
      )}
      <style jsx>{`
        .ccwp { position: absolute; inset: 0; }
        .ccwp-img { display: block; width: 100%; height: 100%; }

        .ccwp-cover {
          -webkit-mask-image: linear-gradient(90deg, transparent 0%, rgba(0,0,0,.5) 22%, #000 48%);
                  mask-image: linear-gradient(90deg, transparent 0%, rgba(0,0,0,.5) 22%, #000 48%);
        }
        .ccwp-cover .ccwp-img { position: absolute; inset: 0; object-fit: cover; animation: ccwp-zoom 3.6s ease-out both; }
        .ccwp-wash { position: absolute; inset: 0; }

        .ccwp-whole {
          container-type: size;
          -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 16%);
                  mask-image: linear-gradient(90deg, transparent 0%, #000 16%);
        }
        .ccwp-frame {
          position: absolute; right: 0; bottom: 0;
          -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 9%), linear-gradient(180deg, transparent 0, #000 5%);
          -webkit-mask-composite: source-in;
                  mask-image: linear-gradient(90deg, transparent 0, #000 9%), linear-gradient(180deg, transparent 0, #000 5%);
                  mask-composite: intersect;
          animation: ccwp-fade .9s ease both;
        }

        @keyframes ccwp-zoom { from { transform: scale(1.06) } to { transform: scale(1) } }
        @keyframes ccwp-fade { from { opacity: 0 } to { opacity: 1 } }

        @media (max-width: 860px) {
          .ccwp-cover {
            -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 38%);
                    mask-image: linear-gradient(180deg, transparent 0%, #000 38%);
          }
          .ccwp-whole {
            -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 20%);
                    mask-image: linear-gradient(180deg, transparent 0%, #000 20%);
          }
        }
      `}</style>
    </div>
  );
}

/** Partner: its name and Capital Craft's joined by a handshake — sits over the greeting.
 *  Names, not logos: every EPC has a name, not every EPC has uploaded a logo. */
export function PartnerLockup({ name }: { name: string }) {
  return (
    <div className="ccwl">
      <span className="ccwl-name">{name}</span>
      <span className="ccwl-line" aria-hidden />
      <span className="ccwl-hand" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#102b5c" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="m11 17 2 2a1 1 0 1 0 3-3" /><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" /><path d="m21 3 1 11h-2" /><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" /><path d="M3 4h8" />
        </svg>
      </span>
      <span className="ccwl-line" aria-hidden />
      <span className="ccwl-name ccwl-cc">Capital Craft</span>
      <style jsx>{`
        .ccwl { display: flex; align-items: center; }
        .ccwl-name {
          max-width: 15em; padding: 12px 20px; border-radius: 16px; text-wrap: balance;
          font-family: "Space Grotesk", Inter, sans-serif; font-weight: 600; font-size: clamp(15px, 1.25vw, 18px); line-height: 1.25;
          color: #102b5c; background: #fff;
          border: 1px solid rgba(16, 43, 92, .10); box-shadow: 0 18px 36px -22px rgba(16, 43, 92, .5);
        }
        .ccwl-cc { color: #fff; background: #102b5c; border-color: #102b5c; white-space: nowrap; }
        .ccwl-line { flex: none; width: clamp(12px, 1.4vw, 22px); height: 2px; background: rgba(16, 43, 92, .22); }
        .ccwl-hand {
          flex: none; width: 42px; height: 42px; border-radius: 50%; background: #fff; display: grid; place-items: center;
          border: 1px solid rgba(16, 43, 92, .08); box-shadow: 0 10px 22px -14px rgba(16, 43, 92, .5);
        }
      `}</style>
    </div>
  );
}

/** Partner card: a sun + "Glad to have you on board!" (the company's name is already in the row above). */
export function PartnerLine() {
  return (
    <div className="flex items-center gap-4">
      <span className="w-12 h-12 rounded-full grid place-items-center bg-[#fff6e6] text-[#f5a623] shrink-0" aria-hidden>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>
      </span>
      <span className="text-[18px] font-semibold text-[#102b5c]">Glad to have you on board!</span>
    </div>
  );
}
