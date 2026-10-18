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
    if (needPassword && !password) { setPwError("Enter your password."); return; }
    setLoading(true);
    const r = await login(mobile, "000000", needPassword ? password : undefined);
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
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={pwError ?? undefined}
        />
      )}
      <Button type="submit" variant="primary" fullWidth loading={loading}
        className="!bg-[#1e3a8a] hover:!bg-[#17307a]">
        Login
      </Button>
    </form>
  );
}
