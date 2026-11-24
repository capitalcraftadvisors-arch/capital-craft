"use client";

// Loan chat · the success screen after a submit (animated tick + falling confetti).

// Falling confetti pieces for the success screen (celebratory motion).
const CONFETTI = Array.from({ length: 18 }).map((_, i) => ({
  left: `${(i * 5.6 + 2) % 98}%`,
  color: ["#1db877", "#5b8def", "#f0b429", "#ffffff", "#93b4ff", "#ff8fb0"][i % 6],
  delay: `${((i * 0.31) % 3).toFixed(2)}s`,
  dur: `${(3 + (i % 5) * 0.7).toFixed(1)}s`,
}));

export default function SuccessScreen({ done, epcName, onBack }: {
  done: { loanId: string | null; borrowerName: string; edit: boolean }; epcName: string; onBack: () => void;
}) {
  const title = done.edit ? "Application updated" : "Application filed successfully";
  return (
    <div className="relative h-screen grid place-items-center px-5 overflow-hidden" style={{ background: "linear-gradient(160deg,#14235c 0%,#1e3a8a 55%,#2a4bb8 100%)" }}>
      {/* Falling confetti */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {CONFETTI.map((c, i) => (
          <span key={i} className="cc-confetti" style={{ left: c.left, background: c.color, animationDelay: c.delay, animationDuration: c.dur }} />
        ))}
      </div>

      <div className="cc-card relative w-full max-w-[460px] bg-white rounded-[28px] shadow-2xl px-8 py-10 text-center">
        <div className="relative w-20 h-20 mx-auto mb-6">
          <span className="absolute inset-0 rounded-full opacity-25 animate-ping" style={{ background: "#1db877" }} />
          <div className="relative w-20 h-20 rounded-full grid place-items-center shadow-[0_12px_30px_-8px_rgba(23,138,92,0.6)]" style={{ background: "linear-gradient(135deg,#1db877,#0f7a52)" }}>
            <svg className="cc-check" width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
        </div>
        <div className="text-[11px] uppercase tracking-[0.22em] font-bold text-[#178a5c]">{title}</div>
        <h1 className="mt-2 font-display text-[27px] font-bold text-[#14235c] leading-tight">{done.borrowerName}</h1>
        {done.loanId && (
          <div className="mt-3 inline-flex items-center gap-1.5 bg-[#eef3fc] text-[#1e3a8a] font-mono text-[13px] font-semibold px-3.5 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-[#1db877]" /> {done.loanId}
          </div>
        )}
        <p className="text-[14px] text-text-mid mt-4 leading-relaxed">
          {done.edit ? "The changes were submitted" : "This application has been successfully created"} by{" "}
          <span className="font-semibold text-[#14235c]">{epcName || "your team"}</span>.<br />
          Our team will reach out to you shortly.
        </p>
        <button onClick={onBack} className="mt-7 w-full px-5 py-3 rounded-xl bg-[#1e3a8a] text-white text-[15px] font-semibold hover:bg-[#17307a] transition-colors">
          Back to dashboard
        </button>
      </div>

      <style jsx>{`
        .cc-card { animation: ccUp .5s cubic-bezier(.2,.8,.2,1) both; }
        @keyframes ccUp { from { opacity: 0; transform: translateY(18px) scale(.97); } to { opacity: 1; transform: none; } }
        .cc-check { stroke-dasharray: 30; stroke-dashoffset: 30; animation: ccDraw .5s .25s ease-out forwards; }
        @keyframes ccDraw { to { stroke-dashoffset: 0; } }
        .cc-confetti { position: absolute; top: -20px; width: 9px; height: 15px; border-radius: 2px; opacity: .9; animation-name: ccFall; animation-timing-function: linear; animation-iteration-count: infinite; }
        @keyframes ccFall { 0% { transform: translateY(-12vh) rotate(0deg); } 100% { transform: translateY(112vh) rotate(560deg); } }
      `}</style>
    </div>
  );
}
