"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "./ui/Button";
import Input from "./ui/Input";
import WelcomeSplash from "./WelcomeSplash";
import { login, routeForBusiness, greetingName, type Business } from "@/lib/auth";
import { MOBILE_RE } from "@/lib/validators";

// The 2-second "Namaste" welcome only plays for the internal team (admins);
// EPCs go straight to their portal. Malvika gets the woman portrait, everyone
// else on the team the man portrait.
function welcomeFor(b: Business | null | undefined): { name: string; image: string } | null {
  if (!b || b.business_type !== "admin") return null;
  const isWoman = /malvika/i.test(b.contact_name || "");
  return { name: greetingName(b), image: isWoman ? "/welcome/woman.png" : "/welcome/man.png" };
}

export default function LoginForm() {
  const router = useRouter();
  const [mobile, setMobile] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [welcome, setWelcome] = useState<{ name: string; image: string; dest: string } | null>(null);

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
    const dest = routeForBusiness(r.business) as string;
    const w = welcomeFor(r.business);
    if (w) setWelcome({ ...w, dest });     // play the greeting, then route on done
    else router.replace(dest as any);
  }

  if (welcome) {
    return <WelcomeSplash name={welcome.name} image={welcome.image} onDone={() => router.replace(welcome.dest as any)} />;
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
      <Button type="submit" variant="primary" fullWidth loading={loading}
        className="!bg-[#1e3a8a] hover:!bg-[#17307a]">
        Login
      </Button>
    </form>
  );
}
