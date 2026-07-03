"use client";

// Small self-contained comments launcher. Renders the button + owns modal
// state + mounts CommentsPanel. Reusable from the admin list row action
// column and from the View page.
//
// Optionally refreshes an external "latest comment" preview via onChanged.

import { useState } from "react";
import CommentsPanel from "@/components/CommentsPanel";

type Props = {
  businessId: string;
  epcName?: string | null;
  onChanged?: () => void;
  size?: "sm" | "md";
  className?: string;
};

const IconChat = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z" />
  </svg>
);

export default function CommentsButton({ businessId, epcName, onChanged, size = "sm", className = "" }: Props) {
  const [open, setOpen] = useState(false);

  const base = size === "md"
    ? "text-[13px] font-semibold px-3 py-2 inline-flex items-center justify-center gap-1.5"
    : "text-[12px] font-semibold px-3 py-1.5 inline-flex items-center justify-center gap-1.5";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={[
          base,
          "rounded-input border border-[#5a8a76]/30 bg-white text-[#0f3d2e] hover:bg-[#f0faf5]",
          className,
        ].join(" ")}
        title="Add or view admin comments"
      >
        {IconChat} Comment
      </button>
      <CommentsPanel
        open={open}
        onClose={() => setOpen(false)}
        businessId={businessId}
        epcName={epcName}
        onChanged={onChanged}
      />
    </>
  );
}
