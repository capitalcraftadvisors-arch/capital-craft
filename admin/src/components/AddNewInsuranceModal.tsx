"use client";

// Admin-only "Add New Insurance Application" flow.
//
// UX:
//   1. Admin clicks "+ Add New Insurance Application" on the Insurance tab.
//   2. Modal shows a dropdown of every non-admin EPC (insurance is not
//      lender-gated — admin may start a profile for anyone).
//   3. On confirm → POST /api/admin/create-insurance-app { epc_business_id }
//      creates a fresh draft row (or resumes an existing draft), then routes
//      to /dashboard/insurance/{id}/step-1 where the admin fills the rest.
//
// The pop-up itself is the shared AddNewApplicationModal (no chooser here).

import AddNewApplicationModal from "@/components/AddNewApplicationModal";

export default function AddNewInsuranceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AddNewApplicationModal
      open={open}
      onClose={onClose}
      title="Add new insurance application"
      pickHint="Pick the EPC partner. A draft insurance profile is created for them."
      lenderApprovedOnly={false}
      loadingText="Loading EPCs…"
      emptyText="No EPC partners found."
      createUrl="/api/admin/create-insurance-app"
      stepOnePath={(id) => `/dashboard/insurance/${id}/step-1`}
    />
  );
}
