"use client";

// Admin — full-page "Message to EPC" window for an insurance profile.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import MessageThread from "@/components/MessageThread";
import { invalidate } from "@/lib/list-cache";
import { epcUpdatesKey } from "@/lib/use-epc-updates";

export default function AdminInsuranceMessagesPage() {
  return (
    <AuthGuard allow={["admin"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [ctx, setCtx] = useState<{ name: string; ref: string } | null>(null);

  useEffect(() => {
    invalidate(epcUpdatesKey());   // opening the thread marks it seen for this admin
    void (async () => {
      const { data } = await supabase().from("insurance_applications")
        .select("aadhaar_name, insurance_display_id, status").eq("id", id).maybeSingle();
      const a = (data ?? {}) as Record<string, any>;
      setCtx({ name: a.aadhaar_name || "(unnamed)", ref: a.insurance_display_id || id.slice(0, 8).toUpperCase() });
    })();
  }, [id]);

  return (
    <main className="min-h-screen bg-bg-soft">
      <div className="max-w-[820px] mx-auto px-5 sm:px-7 py-8">
        <button onClick={() => router.push(`/admin/insurance/${id}/view` as any)} className="text-[13px] text-text-muted hover:text-[#0f3d2e] mb-3">← Back to profile</button>
        <div className="mb-4">
          <h1 className="font-display text-[24px] font-bold text-[#0f3d2e]">Message to EPC</h1>
          <p className="text-[13.5px] text-text-mid mt-0.5">
            {ctx ? <>{ctx.name} · <span className="font-mono text-[#185fa5]">{ctx.ref}</span></> : "…"} — the EPC sees these on their portal and can reply.
          </p>
        </div>
        <MessageThread kind="insurance" id={id} role="admin" />
      </div>
    </main>
  );
}
