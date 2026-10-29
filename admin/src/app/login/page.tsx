import { Cormorant_Garamond } from "next/font/google";
import LoginForm from "@/components/LoginForm";

// Login — all white: the brand emblem in a white roundel, a serif wordmark and
// a white sign-in card with a soft shadow; navy text. The serif face is loaded
// for this page only.
const serif = Cormorant_Garamond({ subsets: ["latin"], weight: ["500", "600", "700"], display: "swap" });

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-white text-[#0f1f4d] flex flex-col items-center px-5">
      <div className="flex-1 w-full flex flex-col items-center justify-center py-12">
        <div className="cc-rise w-full max-w-[420px] flex flex-col items-center">
          <div className="w-[96px] h-[96px] rounded-full grid place-items-center bg-white border border-[#e6e9f0] shadow-[0_14px_36px_-14px_rgba(15,31,77,0.28)]">
            {/* 512px smooth-edged emblem (made from capital-craft-mark.png) — crisp on any screen. */}
            <img src="/brand/capital-craft-mark-hd.png" alt="" className="w-[58px] h-[58px]" />
          </div>
          <div className={`${serif.className} mt-6 text-[32px] font-semibold tracking-wide leading-none`}>Capital Craft</div>
          <div className="mt-2.5 flex items-center gap-3 text-[10.5px] font-semibold tracking-[0.38em] text-[#0f1f4d]/55">
            <span aria-hidden className="h-px w-6 bg-gradient-to-r from-transparent to-[#0f1f4d]/30" />
            FINANCIAL ADVISORS
            <span aria-hidden className="h-px w-6 bg-gradient-to-l from-transparent to-[#0f1f4d]/30" />
          </div>

          <div className="mt-10 w-full rounded-[20px] border border-[#e6e9f0] bg-white p-7 sm:p-8 shadow-[0_30px_70px_-30px_rgba(15,31,77,0.25)]">
            <h1 className={`${serif.className} text-[38px] leading-none font-semibold`}>Welcome</h1>
            <p className="mt-2.5 text-[14.5px] text-[#0f1f4d]/60">Sign in with your mobile number</p>
            <div className="mt-7">
              <LoginForm />
            </div>
          </div>
        </div>
      </div>
      <p className="pb-8 text-center text-[12px] text-[#0f1f4d]/45">
        By continuing you agree to Capital Craft&rsquo;s terms &amp; privacy policy.
      </p>
    </main>
  );
}
