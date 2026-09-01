-- =========================================================
-- 0073 — Loan-lead: separate project cost from loan amount required
--
-- loan_leads previously carried only loan_amount (which convert-to-loan-app
-- maps to the loan application's loan_amount_required). Project cost and the
-- loan amount required can legitimately differ, so capture the project cost in
-- its own column. The lead form (step-1) now has two boxes:
--   • Project cost (₹)          → total_project_cost   (this column)
--   • Loan amount required (₹)  → loan_amount          (unchanged)
-- convert-to-loan-app now maps total_project_cost → epc_applications.total_project_cost.
--
-- Rollback:
--   alter table loan_leads drop column if exists total_project_cost;
-- =========================================================

alter table loan_leads
  add column if not exists total_project_cost numeric(14,2);
