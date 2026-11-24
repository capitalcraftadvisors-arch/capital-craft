"use client";

// EPC View · the Contact card's Password row (main admin only).

import { useState } from "react";
import { notify } from "@/lib/notify";
import { epcLoginPassword } from "@/lib/passwords";
import { CopyButton, I } from "@/components/view/ViewKit";

// Main admin only: the EPC's login password (0110), hidden until the eye is
// clicked — read once then, never on page load.
export default function PasswordKV({ businessId }: { businessId: string }) {
  const [pw, setPw] = useState<string | null | undefined>(undefined); // undefined = not read yet
  const [shown, setShown] = useState(false);
  async function toggle() {
    if (!shown && pw === undefined) {
      try { setPw(await epcLoginPassword(businessId)); } catch { notify.error("Couldn't load the password"); return; }
    }
    setShown((s) => !s);
  }
  return (
    <div className="flex justify-between text-[14px] py-[5px] gap-3">
      <span className="text-cc-muted shrink-0">Password</span>
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="text-right min-w-0 truncate font-medium text-cc-ink">{shown ? pw ?? "—" : "••••••••"}</span>
        {shown && pw && <CopyButton value={pw} />}
        <button type="button" onClick={toggle} aria-label={shown ? "Hide password" : "Show password"} title={shown ? "Hide password" : "Show password"}
          className="p-1 rounded text-cc-muted hover:text-cc-ink">
          {I.eye}
        </button>
      </span>
    </div>
  );
}
