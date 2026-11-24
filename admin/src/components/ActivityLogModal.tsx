"use client";

// Modal wrapper around <ActivityLog />. Rendered from the View page's
// Actions strip. Full-height scrollable list; close on backdrop or × click.

import { useId, type ReactNode } from "react";
import ActivityLog from "@/components/ActivityLog";
import Modal from "@/components/ui/Modal";

type Props = {
  open: boolean;
  onClose: () => void;
  businessId: string;
  epcName?: string | null;
  refreshKey?: number;
};

export default function ActivityLogModal({ open, onClose, businessId, epcName, refreshKey }: Props) {
  if (!open) return null;
  return (
    <LogModalFrame
      onClose={onClose}
      name={epcName}
      subtitle="Chronological — admin edits, EPC self-edits, status changes, lender ticks, and comments."
    >
      <ActivityLog businessId={businessId} refreshKey={refreshKey} />
    </LogModalFrame>
  );
}

/** The activity-log pop-up: "Activity log — <name>", a one-line subtitle, ×,
 *  and the scrolling list. Also used by the loan log (LoanActivityLogModal). */
export function LogModalFrame({ onClose, name, subtitle, children }: {
  onClose: () => void; name?: string | null; subtitle: string; children: ReactNode;
}) {
  const titleId = useId();
  return (
    <Modal onClose={onClose} className="w-full max-w-2xl bg-white rounded-lg shadow-lg flex flex-col max-h-[90vh]" aria-labelledby={titleId}>
      <div className="p-5 border-b border-line flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={titleId} className="font-display font-semibold text-[18px] text-text truncate">
            Activity log{name ? ` — ${name}` : ""}
          </h3>
          <p className="text-[12px] text-text-mid mt-0.5">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[20px] text-text-muted hover:text-text leading-none"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">{children}</div>
    </Modal>
  );
}
