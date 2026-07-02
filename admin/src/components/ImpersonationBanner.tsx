"use client";

// Yellow-tinted sticky banner shown on onboarding pages when the admin is
// walking through the wizard on behalf of a manually-added EPC. Renders
// nothing when no impersonation is active.
//
// The banner tells the admin whose account they're editing and gives them
// an Exit control that clears impersonation and returns to /admin.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { endImpersonation, getImpersonatedBusiness } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export default function ImpersonationBanner() {
  const router = useRouter();
  const [mobile, setMobile] = useState<string | null>(null);
  const [displayId, setDisplayId] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const biz = getImpersonatedBusiness();
    if (!biz) return;
    setVisible(true);
    // Look up mobile + display_id fresh — the impersonation payload is a
    // minimal Business snapshot and doesn't carry them.
    (async () => {
      const { data } = await supabase()
        .from("epc_business")
        .select("contact_mobile, epc_display_id")
        .eq("id", biz.id)
        .maybeSingle();
      if (data) {
        setMobile((data.contact_mobile as string) ?? null);
        setDisplayId((data.epc_display_id as string) ?? null);
      }
    })();
  }, []);

  function exit() {
    endImpersonation();
    router.push("/admin");
  }

  if (!visible) return null;

  return (
    <div className="sticky top-0 z-40 bg-amber-100 border-b border-amber-300 text-amber-900">
      <div className="max-w-container mx-auto px-5 sm:px-7 py-2.5 flex items-center justify-between gap-3">
        <div className="text-[12px] sm:text-[13px]">
          <span className="font-semibold">Admin mode:</span>{" "}
          Adding a new EPC on behalf of{" "}
          <span className="font-mono">+91 {mobile ?? "—"}</span>
          {displayId && (
            <span className="ml-2 hidden sm:inline text-amber-700">{displayId}</span>
          )}
        </div>
        <button
          type="button"
          onClick={exit}
          className="text-[12px] font-semibold underline hover:no-underline"
        >
          Exit admin mode
        </button>
      </div>
    </div>
  );
}
