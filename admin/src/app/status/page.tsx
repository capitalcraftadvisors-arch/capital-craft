"use client";

import { useEffect, useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/StatusBadge";
import { getBusiness, logout } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

type Biz = {
  id: string;
  status: "under_review" | "on_hold" | "rejected" | "approved" | "draft";
  contact_name: string | null;
  contact_mobile: string | null;
  business_type: string | null;
  epc_self_edited?: boolean;
};

// EPC-facing copy is DELIBERATELY uniform across every internal status.
// Whether the internal team has marked this row as under_review, on_hold,
// rejected, or (internal) approved, the EPC always sees "Under review".
// The only thing that changes the EPC's view is a lender "Approved" tick,
// which unlocks loan_app and routes them to /dashboard (see AuthGuard +
// routeForBusiness). No status leak from admin's internal tracking.
const EPC_MESSAGE = {
  title: "Application under review",
  body: "Thanks — we&rsquo;ve received your profile. Our team will get back to you shortly.",
};

const SELF_EDIT_SNAPSHOT_KEY = "cc_self_edit_snapshot";

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

  useEffect(() => {
    // AuthGuard already re-fetched + cached the latest business. Read it.
    const b = getBusiness() as Biz | null;
    setBiz(b);
  }, []);

  if (!biz) return null;
  // Uniform copy regardless of biz.status — see EPC_MESSAGE.
  const msg = EPC_MESSAGE;
  // The one-time edit is offered to any submitted EPC who hasn't used it yet,
  // regardless of internal status (under_review / on_hold / approved /
  // rejected). Draft EPCs never land on /status — they stay in the onboarding
  // wizard. The DB trigger (0010) and /api/epc/submit-self-edit both still
  // enforce the one-time lock via epc_self_edited alone, so relaxing this UI
  // gate does not weaken the guarantee.
  const showEditButton = biz.epc_self_edited !== true;

  async function startSelfEdit() {
    // Capture a snapshot of the fields the audit endpoint expects in `before`.
    // We pull current values from the DB so the diff is computed against
    // accurate baseline, not stale localStorage state.
    const { data } = await supabase()
      .from("epc_business")
      .select(
        "contact_name, contact_email, contact_designation, business_type, " +
        "pan_number, bank_account_number, bank_ifsc, bank_branch, " +
        "bank_account_holder, bank_name, stakeholders, business_references",
      )
      .eq("id", biz!.id)
      .maybeSingle();
    if (data) {
      localStorage.setItem(SELF_EDIT_SNAPSHOT_KEY, JSON.stringify(data));
    }
    router.push("/onboarding/step-1");
  }

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
          {/* Hardcoded to "under_review" so the pill never leaks the real
              internal status. Admin views of StatusBadge still show the
              real value — that component is unchanged. */}
          <StatusBadge status="under_review" updated={biz.epc_self_edited === true} />
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

          {showEditButton && (
            <div className="mt-6 pt-6 border-t border-line">
              <p className="text-[13px] text-text-mid mb-3">
                Spotted something to fix? You can edit your details once before
                we finish reviewing.
              </p>
              <Button variant="primary" onClick={startSelfEdit}>
                Edit Dashboard
              </Button>
            </div>
          )}

          {biz.epc_self_edited === true && (
            <p className="mt-6 pt-6 border-t border-line text-[12px] text-text-muted">
              You&rsquo;ve used your one-time edit. Any further changes need to
              go through our team.
            </p>
          )}
        </Card>
      </section>
    </main>
  );
}
