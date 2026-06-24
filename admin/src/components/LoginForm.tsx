"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "./ui/Button";
import Input from "./ui/Input";
import { login, routeForBusiness } from "@/lib/auth";
import { MOBILE_RE } from "@/lib/validators";

export default function LoginForm() {
  const router = useRouter();
  const [mobile, setMobile] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!MOBILE_RE.test(mobile)) {
      setError("Enter a valid 10-digit mobile number starting with 6-9.");
      return;
    }
    setLoading(true);
    const r = await login(mobile, "000000");
    setLoading(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
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
        onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
        error={error ?? undefined}
      />
      <Button type="submit" variant="primary" fullWidth loading={loading}>
        Login
      </Button>
    </form>
  );
}
