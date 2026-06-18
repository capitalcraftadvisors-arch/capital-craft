"use client";

import { useEffect, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/StatusBadge";
import { getBusiness, logout } from "@/lib/auth";
import { useRouter } from "next/navigation";

type Biz = {
  status: "under_review" | "on_hold" | "rejected" | "approved" | "draft";
  contact_name: string | null;
  contact_mobile: string | null;
  business_type: string | null;
};

const MESSAGES: Record<string, { title: string; body: string }> = {
  under_review: {
    title: "Application under review",
    body: "Thanks — we&rsquo;ve received your profile. Our team will get back to you shortly.",
  },
  on_hold: {
    title: "We need more information",
    body: "Your application is on hold. Our team will contact you about what&rsquo;s missing.",
  },
  rejected: {
    title: "Not approved this time",
    body: "Unfortunately we couldn&rsquo;t approve your application. Reach out if you&rsquo;d like to know more.",
  },
};

export default function StatusPage() {
  return (
    <AuthGuard allow={["status"]}>
      <StatusInner />
    </AuthGuard>
  );
}

function StatusInner() {
  const router = useRouter();
  const [biz, setBiz] = useState<Biz | null>(null);
  useEffect(() => { setBiz(getBusiness() as Biz | null); }, []);
  if (!biz) return null;
  const msg = MESSAGES[biz.status] ?? { title: "Application status", body: "" };

  return (
    <main className="min-h-screen bg-bg-soft">
      <header className="border-b border-line bg-white">
        <div className="max-w-container mx-auto px-7 h-16 flex items-center justify-between">
          <a href="/" className="font-display font-bold text-[20px] grad-text">Capital Craft</a>
          <button
            onClick={() => { logout(); router.replace("/login"); }}
            className="text-[13px] text-text-muted hover:text-text"
          >
            Log out
          </button>
        </div>
      </header>

      <section className="max-w-[560px] mx-auto px-5 sm:px-7 py-12 sm:py-20">
        <Card className="p-7 sm:p-9 text-center">
          <StatusBadge status={biz.status} />
          <h1 className="font-display text-[24px] sm:text-[28px] font-bold mt-4">{msg.title}</h1>
          <p className="text-text-mid mt-2" dangerouslySetInnerHTML={{ __html: msg.body }} />
          <div className="mt-6 pt-6 border-t border-line text-left grid gap-2 text-[13px]">
            <div className="flex gap-4">
              <span className="text-text-muted min-w-[100px]">Name</span>
              <span>{biz.contact_name || "—"}</span>
            </div>
            <div className="flex gap-4">
              <span className="text-text-muted min-w-[100px]">Mobile</span>
              <span>+91 {biz.contact_mobile || "—"}</span>
            </div>
            <div className="flex gap-4">
              <span className="text-text-muted min-w-[100px]">Business type</span>
              <span className="capitalize">{biz.business_type || "—"}</span>
            </div>
          </div>
        </Card>
      </section>
    </main>
  );
}
