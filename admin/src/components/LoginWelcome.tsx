"use client";

// The full-screen welcome right after a login. login() sets sessionStorage
// "cc_greet"; it is consumed once here, so the welcome plays for that login only,
// over the landing page as it loads — when it fades, the page is already there.
//
// Mounted on the admin console (admin/page.tsx), the owner's portal (admin/pri)
// and the EPC dashboard (dashboard/page.tsx). Each page is role-scoped by its
// AuthGuard, so the business_type read here tells the two apart:
//   • Capital Craft team → green: "Welcome back," + the person's name; the photo:
//                          Manish the namaste man, Malvika the namaste woman,
//                          the main Admin (and anyone else) the team photo
//   • EPC partner        → navy: its name 🤝 Capital Craft, "Welcome to Capital
//                          Craft!", ☀ "Glad to have you on board!"; the solar
//                          photo fading into the page
// Names come from the signed-in account (never hard-coded).

import { useEffect, useState } from "react";
import { getBusiness, greetingName } from "@/lib/auth";
import { fetchEpcName } from "@/lib/epc-name";
import WelcomeScreen, { PartnerLine, PartnerLockup, WelcomePhoto } from "./WelcomeScreen";

const TEAM_MESSAGES = [
  <>Great things happen when we <b className="text-[#178a5c]">work together</b>.</>,
  <>Every day is another opportunity to build something <b className="text-[#178a5c]">meaningful</b>.</>,
  <>Every great journey is built by a strong team. Let&apos;s make <b className="text-[#178a5c]">today</b> count.</>,
];
const PARTNER_MESSAGE = (
  <>Thank you for being a part of our journey. Together, let&apos;s make rooftop solar more accessible,{" "}
    <b className="text-[#178a5c]">sustainable</b> and <b className="text-[#102b5c]">impactful</b>.</>
);

export default function LoginWelcome() {
  const [kind, setKind] = useState<"team" | "partner" | null>(null);
  useEffect(() => {
    let show = false;
    try {
      show = sessionStorage.getItem("cc_greet") === "1";
      if (show) sessionStorage.removeItem("cc_greet");
    } catch { return; }
    const b = show ? getBusiness() : null;
    if (b) setKind(b.business_type === "admin" ? "team" : "partner");
  }, []);

  if (kind === "team") return <TeamWelcome onDone={() => setKind(null)} />;
  if (kind === "partner") return <PartnerWelcome onDone={() => setKind(null)} />;
  return null;
}

function TeamWelcome({ onDone }: { onDone: () => void }) {
  const b = getBusiness();
  const name = greetingName(b);
  const isMain = b?.role === "MAIN_ADMIN" && !b?.is_owner;
  const message = TEAM_MESSAGES[Math.floor(Date.now() / 86_400_000) % TEAM_MESSAGES.length]; // one a day
  const who = b?.contact_name || "";
  const photo = /malvika/i.test(who) ? "woman" : /manish/i.test(who) ? "man" : "team"; // the main Admin (and anyone else): the team photo
  return (
    <WelcomeScreen tone="team" badge="Team Portal" onDone={onDone}
      lead={isMain ? "Welcome back to" : "Welcome back,"}
      name={isMain ? "your workspace!" : `${name}!`}
      message={message}
      tagline="Let's achieve more, together."
      picture={<WelcomePhoto photo={photo} />} />
  );
}

function PartnerWelcome({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => { void fetchEpcName().then(setName); }, []); // the portal's cached read
  if (name == null) return null;
  const company = name && name !== "there" ? name : "";
  return (
    <WelcomeScreen tone="partner" badge="Partner Portal" onDone={onDone}
      above={company ? <PartnerLockup name={company} /> : undefined}
      lead="Welcome to"
      name="Capital Craft!"
      message={PARTNER_MESSAGE}
      chip={<PartnerLine />}
      tagline="Growing together."
      picture={<WelcomePhoto photo="solar" />} />
  );
}
