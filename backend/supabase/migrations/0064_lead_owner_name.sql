-- =========================================================
-- 0064 — Lead owner name on loan_leads
--
-- The single-step lead form now captures a "Lead Owner Name" (the person who
-- owns/sourced the lead), shown in the Leads dashboard under the EPC name.
-- Additive, nullable — existing rows are unaffected.
--
-- NOT YET APPLIED to production (written on the loan-app-lender-flow branch;
-- apply only against an isolated dev DB until reviewed).
--
-- Rollback: alter table loan_leads drop column if exists lead_owner_name;
-- =========================================================

alter table loan_leads
  add column if not exists lead_owner_name text;
