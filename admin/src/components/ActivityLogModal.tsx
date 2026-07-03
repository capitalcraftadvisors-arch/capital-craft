"use client";

// Modal wrapper around <ActivityLog />. Rendered from the View page's
// Actions strip. Full-height scrollable list; close on backdrop or × click.

import ActivityLog from "@/components/ActivityLog";

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
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-white rounded-lg shadow-lg flex flex-col max-h-[90vh]"
      >
        <div className="p-5 border-b border-line flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-[18px] text-text truncate">
              Activity log{epcName ? ` — ${epcName}` : ""}
            </h3>
            <p className="text-[12px] text-text-mid mt-0.5">
              Chronological — admin edits, EPC self-edits, status changes, lender ticks, and comments.
            </p>
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

        <div className="flex-1 overflow-y-auto p-5">
          <ActivityLog businessId={businessId} refreshKey={refreshKey} />
        </div>
      </div>
    </div>
  );
}
