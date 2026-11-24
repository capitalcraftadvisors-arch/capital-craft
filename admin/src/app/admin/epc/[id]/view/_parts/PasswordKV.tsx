"use client";

// EPC View · the Contact card's Password row (main admin only).

import { useState } from "react";
import { toast } from "sonner";
import { epcLoginPassword } from "@/lib/passwords";
import { CopyButton, I } from "@/components/view/ViewKit";

// Main admin only: the EPC's login password (0110), hidden until the eye is
// clicked — read once then, never on page load.
export default function PasswordKV({ businessId }: { businessId: string }) {
  const [pw, setPw] = useState<string | null | undefined>(undefined); // undefined = not read yet
  const [shown, setShown] = useState(false);
  async function toggle() {
    if (!shown && pw === undefined) {
      try { setPw(await epcLoginPassword(businessId)); } catch { toast.error("Couldn't load the password"); return; }
    }
    setShown((s) => !s);
  }
  return (
    <div className="flex justify-between text-[14px] py-[5px] gap-3">
      <span className="text-[#5a8a76] shrink-0">Password</span>
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="text-right min-w-0 truncate font-medium text-[#0f3d2e]">{shown ? pw ?? "—" : "••••••••"}</span>
        {shown && pw && <CopyButton value={pw} />}
        <button type="button" onClick={toggle} aria-label={shown ? "Hide password" : "Show password"} title={shown ? "Hide password" : "Show password"}
          className="p-1 rounded text-[#5a8a76] hover:text-[#0f3d2e]">
          {I.eye}
        </button>
      </span>
    </div>
  );
}
