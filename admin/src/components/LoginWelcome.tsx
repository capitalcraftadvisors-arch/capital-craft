"use client";

// Plays the role-aware "Namaste" welcome ON the destination page (not the login
// page) right after a login. login() sets sessionStorage "cc_greet"; we consume
// it once and show WelcomeSplash. Because the splash covers the page WHILE it
// loads, there's no flash between the greeting and the page — when the splash
// fades, the destination is already underneath.
//
// Mounted on BOTH the admin console (admin/page.tsx) and the EPC dashboard
// (dashboard/page.tsx). Each page is role-scoped by its AuthGuard, so the
// business_type read here reliably tells the two apart:
//   • Admin / team  → English "Namaste, {name}" + man/woman portrait.
//   • EPC partner   → Hindi "नमस्ते, {name}" · "Capital Craft में आपका स्वागत है"
//                     with the man portrait (the welcoming host).

import { useEffect, useState } from "react";
import { getBusiness, greetingName } from "@/lib/auth";
import { fetchEpcName } from "@/lib/epc-name";
import WelcomeSplash from "./WelcomeSplash";

type Greet = { name: string; image: string; greeting: string; subtitle: string; badge: string };

export default function LoginWelcome() {
  const [w, setW] = useState<Greet | null>(null);
  useEffect(() => {
    let show = false;
    try {
      show = sessionStorage.getItem("cc_greet") === "1";
      if (show) sessionStorage.removeItem("cc_greet");
    } catch { return; }
    if (!show) return;
    const b = getBusiness();
    if (!b) return;

    if (b.business_type === "admin") {
      const isWoman = /malvika/i.test(b.contact_name || "");
      setW({
        name: greetingName(b),
        image: isWoman ? "/welcome/woman.png" : "/welcome/man.png",
        greeting: "Namaste,", subtitle: "Welcome back", badge: "Private Workspace",
      });
      return;
    }

    // EPC partner — greet by the (short) BUSINESS name, not the contact person.
    void fetchEpcName().then((name) => setW({
      name,
      image: "/welcome/man.png",
      greeting: "नमस्ते,",
      subtitle: "Capital Craft में आपका स्वागत है",
      badge: "Portal",
    }));
  }, []);

  if (!w) return null;
  return (
    <WelcomeSplash
      name={w.name} image={w.image}
      greeting={w.greeting} subtitle={w.subtitle} badge={w.badge}
      onDone={() => setW(null)}
    />
  );
}
