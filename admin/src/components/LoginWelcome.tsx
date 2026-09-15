"use client";

// Plays the role-aware "Namaste" welcome ON the dashboard (not the login page)
// right after a login. login() sets sessionStorage "cc_greet"; we consume it once
// and show WelcomeSplash. Because the splash covers the dashboard WHILE it loads,
// there's no flash of the login page between the greeting and the dashboard — when
// the splash fades, the dashboard is already underneath.

import { useEffect, useState } from "react";
import { getBusiness, greetingName } from "@/lib/auth";
import WelcomeSplash from "./WelcomeSplash";

export default function LoginWelcome() {
  const [w, setW] = useState<{ name: string; image: string } | null>(null);
  useEffect(() => {
    let show = false;
    try {
      show = sessionStorage.getItem("cc_greet") === "1";
      if (show) sessionStorage.removeItem("cc_greet");
    } catch { return; }
    if (!show) return;
    const b = getBusiness();
    if (!b || b.business_type !== "admin") return; // internal team only
    const isWoman = /malvika/i.test(b.contact_name || "");
    setW({ name: greetingName(b), image: isWoman ? "/welcome/woman.png" : "/welcome/man.png" });
  }, []);

  if (!w) return null;
  return <WelcomeSplash name={w.name} image={w.image} onDone={() => setW(null)} />;
}
