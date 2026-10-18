"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "./ui/Button";
import Input from "./ui/Input";
import { login, routeForBusiness } from "@/lib/auth";
import { MOBILE_RE } from "@/lib/validators";

// Mobile first. An account CC has set a password for (migration 0094) is
// answered with passwordRequired → the password field appears; accounts
// without a password yet log straight in with the mobile, as before.
export default function LoginForm() {
  const router = useRouter();
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [needPassword, setNeedPassword] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setPwError(null);
    if (!MOBILE_RE.test(mobile)) {
      setError("Enter a valid 10-digit mobile number starting with 6-9.");
      return;
    }
    // Generated passwords never contain spaces — drop any copied from the email.
    const pw = password.replace(/\s+/g, "");
    if (needPassword && !pw) { setPwError("Enter your password."); return; }
    setLoading(true);
    const r = await login(mobile, "000000", needPassword ? pw : undefined);
    setLoading(false);
    if (!r.ok) {
      if (r.passwordRequired) {
        // First time: just reveal the password field; after that show the reason.
        if (needPassword) setPwError(r.error); else setNeedPassword(true);
        return;
      }
      setError(r.error);
      return;
    }
    // Route straight to the destination. The "Namaste" welcome (login sets the
    // cc_greet flag) now plays ON the dashboard via <LoginWelcome/>, so it covers
    // the dashboard as it loads — no flash of the login page in between.
    router.replace(routeForBusiness(r.business) as any);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Input
        label="Mobile number"
        inputMode="numeric"
        autoComplete="tel"
        maxLength={10}
        placeholder="9876543210"
        value={mobile}
        onChange={(e) => { setMobile(e.target.value.replace(/\D/g, "")); setNeedPassword(false); setPassword(""); setPwError(null); }}
        error={error ?? undefined}
      />
      {needPassword && (
        <Input
          label="Password"
          type={showPw ? "text" : "password"}
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={pwError ?? undefined}
          rightSlot={
            <button type="button" onClick={() => setShowPw((s) => !s)}
              aria-label={showPw ? "Hide password" : "Show password"} title={showPw ? "Hide password" : "Show password"}
              className="p-1.5 rounded text-text-muted hover:text-text">
              {showPw ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 10 8 10 8a13.2 13.2 0 0 1-1.67 2.68M6.6 6.6A13.5 13.5 0 0 0 2 12s3 8 10 8a9.7 9.7 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /><path d="M2 2l20 20" /></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 12s3.5-7 10.5-7 10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" /><circle cx="12" cy="12" r="3" /></svg>
              )}
            </button>
          }
        />
      )}
      <Button type="submit" variant="primary" fullWidth loading={loading}
        className="!bg-[#1e3a8a] hover:!bg-[#17307a]">
        Login
      </Button>
    </form>
  );
}
