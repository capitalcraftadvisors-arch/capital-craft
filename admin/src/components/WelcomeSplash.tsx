"use client";

// A short, premium role-aware welcome shown for ~2s right after login, then it
// hands off to the destination page. Malvika sees the woman portrait, Manish /
// Admin the man portrait, each greeted by name. The portrait rises with a gentle
// "namaste" bow and keeps a soft idle float; the whole card fades out at the end.

import { useEffect, useState } from "react";

export default function WelcomeSplash({
  name, image, onDone,
}: { name: string; image: string; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), 1850); // begin fade-out
    const t2 = setTimeout(onDone, 2250);                 // hand off
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);

  return (
    <div className={"ccw " + (leaving ? "ccw-out" : "")} role="dialog" aria-label={`Welcome, ${name}`}>
      <span className="ccw-badge">Private Workspace</span>

      <div className="ccw-copy">
        <img src="/brand/capital-craft.png" alt="Capital Craft" className="ccw-logo" />
        <h1 className="ccw-title">Namaste,<span>{name}</span></h1>
        <p className="ccw-sub">Welcome back</p>
      </div>

      <div className="ccw-stage">
        <span className="ccw-halo" aria-hidden />
        <span className="ccw-ring" aria-hidden />
        <span className="ccw-float">
          <img src={image} alt="" className="ccw-person" />
        </span>
      </div>

      <div className="ccw-foot">
        <span>◌ &nbsp;Opening your workspace</span>
        <span>✦ &nbsp;Just for you</span>
      </div>

      <style jsx>{`
        .ccw {
          position: fixed; inset: 0; z-index: 200; overflow: hidden;
          display: flex; flex-direction: column; align-items: center;
          font-family: Inter, system-ui, Arial, sans-serif; color: #12564b;
          animation: ccw-in .45s ease both;
          background:
            radial-gradient(circle at 78% 12%, rgba(255,255,255,.7) 0 16%, transparent 16.4%),
            radial-gradient(120% 90% at 50% 108%, #bfe0d0 0%, transparent 60%),
            linear-gradient(135deg, #e9f4ee 0%, #d6e9df 55%, #cbe3d7 100%);
        }
        .ccw-out { animation: ccw-fade .4s ease forwards; }

        .ccw-badge {
          position: absolute; top: 22px; right: clamp(18px, 6vw, 64px);
          font-size: 10px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase;
          color: #4b7d6f; display: inline-flex; align-items: center; gap: 8px;
        }
        .ccw-badge::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #2c9b73; box-shadow: 0 0 0 4px rgba(44,155,115,.18); }

        .ccw-copy { position: relative; z-index: 5; text-align: center; margin-top: clamp(48px, 10vh, 104px); animation: ccw-rise .7s .1s cubic-bezier(.2,.7,.2,1) both; }
        .ccw-logo { height: clamp(30px, 4.4vh, 46px); width: auto; margin: 0 auto 22px; }
        .ccw-title {
          margin: 0; font-family: Georgia, "Times New Roman", serif; font-weight: 400;
          font-size: clamp(46px, 8.2vw, 104px); line-height: .9; letter-spacing: -.05em; color: #12564b;
        }
        .ccw-title span { display: block; color: #2f8b76; font-size: .82em; }
        .ccw-sub {
          display: inline-block; margin: clamp(16px, 3vh, 30px) 0 0; padding: 8px 20px;
          font-size: clamp(13px, 1.4vw, 17px); color: #47786b;
          background: rgba(255,255,255,.62); border: 1px solid rgba(78,145,119,.18);
          border-radius: 999px; backdrop-filter: blur(6px);
        }

        .ccw-stage {
          position: absolute; left: 50%; bottom: 0; transform: translateX(-50%);
          width: min(92vw, 640px); height: min(66vh, 620px);
          display: flex; align-items: flex-end; justify-content: center;
        }
        .ccw-halo {
          position: absolute; bottom: 6%; left: 50%; transform: translateX(-50%);
          width: min(78vw, 500px); height: min(78vw, 500px); border-radius: 50%;
          background: radial-gradient(circle, rgba(255,255,255,.85) 0%, rgba(207,232,220,.5) 42%, transparent 66%);
          animation: ccw-halo 3.2s ease-in-out infinite;
        }
        .ccw-ring {
          position: absolute; bottom: 9%; left: 50%; transform: translateX(-50%);
          width: min(58vw, 380px); height: min(58vw, 380px); border-radius: 50%;
          border: 1px solid rgba(78,145,119,.22);
        }
        .ccw-float { position: relative; z-index: 2; height: 100%; display: flex; align-items: flex-end; animation: ccw-float 4s ease-in-out .95s infinite; }
        .ccw-person {
          height: 100%; width: auto; object-fit: contain; object-position: bottom center;
          filter: drop-shadow(0 22px 20px rgba(23,80,64,.18));
          animation: ccw-person-in 1s cubic-bezier(.16,.9,.3,1) both;
        }
        .ccw-stage::after {
          content: ""; position: absolute; bottom: 4%; left: 50%; transform: translateX(-50%);
          width: 42%; height: 16px; border-radius: 50%; background: rgba(23,80,64,.16); filter: blur(13px);
        }

        .ccw-foot {
          position: absolute; left: 0; right: 0; bottom: 20px; padding: 0 clamp(18px, 6vw, 64px);
          display: flex; justify-content: space-between; z-index: 6;
          font-size: 9px; font-weight: 800; letter-spacing: .15em; text-transform: uppercase; color: #5d857a;
        }

        @keyframes ccw-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes ccw-fade { to { opacity: 0; transform: scale(1.015) } }
        @keyframes ccw-rise { from { opacity: 0; transform: translateY(-18px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes ccw-person-in {
          0%   { opacity: 0; transform: translateY(64px) scale(.95) }
          62%  { opacity: 1; transform: translateY(-7px) scale(1.012) }
          100% { opacity: 1; transform: translateY(0) scale(1) }
        }
        @keyframes ccw-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-9px) } }
        @keyframes ccw-halo { 0%,100% { opacity: .55; transform: translateX(-50%) scale(1) } 50% { opacity: .8; transform: translateX(-50%) scale(1.05) } }

        @media (max-width: 640px) {
          .ccw-copy { margin-top: 74px; }
          .ccw-stage { width: 96vw; height: 58vh; }
          .ccw-foot { font-size: 7px; letter-spacing: .08em; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ccw, .ccw-copy, .ccw-person, .ccw-float, .ccw-halo { animation: ccw-in .3s ease both; }
        }
      `}</style>
    </div>
  );
}
