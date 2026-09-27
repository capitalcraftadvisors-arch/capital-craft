"use client";

// EPC portal — full-page message thread with the Capital Craft team, for a
// loan or insurance profile. Reached from the "Needs attention" panel on the
// dashboard. "Edit application" jumps to the right edit flow (loan → the edit
// chatbot, pre-opened to the tagged document; insurance → its step flow).

import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import MessageThread from "@/components/MessageThread";
import type { MsgKind } from "@/lib/messages";

export default function EpcMessagesPage() {
  return (
    <AuthGuard allow={["approved"]}>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const params = useParams<{ kind: string; id: string }>();
  const router = useRouter();
  const kind: MsgKind = params.kind === "insurance" ? "insurance" : "loan";
  const id = params.id;

  function onEdit(docTags: string[]) {
    if (kind === "loan") {
      const doc = docTags.length ? `&doc=${encodeURIComponent(docTags.join(","))}` : "";
      router.push(`/dashboard/apply/chat?id=${id}&edit=1${doc}` as any);
    } else {
      router.push(`/dashboard/insurance/${id}/step-1` as any);
    }
  }

  return (
    <main className="min-h-screen bg-bg-soft">
      <div className="max-w-[720px] mx-auto px-4 sm:px-6 py-6">
        <button onClick={() => router.push("/dashboard")} className="text-[13px] text-text-muted hover:text-[#14235c] mb-3">← Back to dashboard</button>
        <div className="mb-4">
          <h1 className="font-display text-[22px] font-bold text-[#14235c]">Message from Capital Craft</h1>
          <p className="text-[13px] text-text-mid mt-0.5">Read the team’s message, reply, and update your application.</p>
        </div>
        <MessageThread kind={kind} id={id} role="epc" onEdit={onEdit} />
      </div>
    </main>
  );
}
