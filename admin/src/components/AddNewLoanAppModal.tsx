"use client";

// Admin-only "Add New Loan Application" flow.
//
// UX:
//   1. Admin clicks "+ New Applicant" on the Loan applications tab.
//   2. A CHOOSER appears — two ways to create the application:
//        • Application maker (chatbot)  → /admin/app/intake (guided chat that builds the
//          whole profile from documents + a few questions).
//        • Classic form       → pick an approved EPC, then the step-by-step
//          wizard (the original flow, unchanged).
//   3. Classic: dropdown shows EPCs with has_lender_approval=true. On confirm →
//      POST /api/admin/create-loan-app { epc_business_id } → routes to
//      /admin/app/{id}/step-1.
//
// The pop-up itself is the shared AddNewApplicationModal.

import AddNewApplicationModal from "@/components/AddNewApplicationModal";

const CHOOSER = { hint: "Choose how you'd like to create this application.", chatPath: "/admin/app/intake" };

export default function AddNewLoanAppModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AddNewApplicationModal
      open={open}
      onClose={onClose}
      title="Add new loan application"
      pickHint="Pick the EPC partner. Only EPCs approved by at least one lender appear here."
      lenderApprovedOnly
      loadingText="Loading eligible EPCs…"
      emptyText={
        <>
          No EPC has been approved by any lender yet. Tick &ldquo;Approved&rdquo; on
          an EPC in the list before starting a loan application.
        </>
      }
      createUrl="/api/admin/create-loan-app"
      stepOnePath={(id) => `/admin/app/${id}/step-1`}
      chooser={CHOOSER}
    />
  );
}
