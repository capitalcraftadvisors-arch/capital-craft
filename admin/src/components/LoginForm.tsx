"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "./ui/Button";
import Input from "./ui/Input";
import { login, routeForBusiness } from "@/lib/auth";
import { MOBILE_RE } from "@/lib/validators";

type Stage = "mobile" | "otp";

export default function LoginForm() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("mobile");
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleMobileSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!MOBILE_RE.test(mobile)) {
      setError("Enter a valid 10-digit mobile number starting with 6-9.");
      return;
    }
    setStage("otp");
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const r = await login(mobile, otp);
    setLoading(false);
    if (!r.ok) {
      setError(r.error === "invalid_otp" ? "Invalid OTP. For v1 use 1234." : r.error);
      return;
    }
    router.replace(routeForBusiness(r.business) as any);
  }

  return (
    <form
      onSubmit={stage === "mobile" ? handleMobileSubmit : handleOtpSubmit}
      className="space-y-5"
    >
      {stage === "mobile" ? (
        <Input
          label="Mobile number"
          inputMode="numeric"
          autoComplete="tel"
          maxLength={10}
          placeholder="9876543210"
          value={mobile}
          onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
          error={error ?? undefined}
        />
      ) : (
        <>
          <div className="rounded-input bg-blue-50 border border-blue/15 px-3.5 py-3 text-[13px] text-text-mid">
            We sent an OTP to <strong className="text-text">+91 {mobile}</strong>.{" "}
            <button
              type="button"
              className="text-blue font-semibold hover:underline"
              onClick={() => {
                setStage("mobile");
                setOtp("");
                setError(null);
              }}
            >
              Change
            </button>
          </div>
          <Input
            label="OTP"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="enter the otp"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            error={error ?? undefined}
            hint="Enter the OTP provided by your administrator."
          />
        </>
      )}

      <Button type="submit" variant="primary" fullWidth loading={loading}>
        {stage === "mobile" ? "Send OTP" : "Verify & continue"}
      </Button>
    </form>
  );
}
