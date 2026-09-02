-- =========================================================
-- 0074 — Loan application: lead owner name
--
-- loan_leads already carries lead_owner_name (0064), but a loan application
-- created directly (classic form / intake chat) had nowhere to record who
-- owns the lead. Add it to epc_applications so it's captured on Step 1 and
-- in the chat, shown on the profile's identity card and the Task Manager
-- drawer, and carried over by convert-to-loan-app from the lead.
--
-- Rollback: alter table epc_applications drop column if exists lead_owner_name;
-- =========================================================

alter table epc_applications
  add column if not exists lead_owner_name text;
