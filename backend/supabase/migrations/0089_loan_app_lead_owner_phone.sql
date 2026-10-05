-- =========================================================
-- 0089 — Loan application: lead owner phone
--
-- 0074 added epc_applications.lead_owner_name (who owns the lead). The EPC
-- chatbot now also captures that person's phone number, asked just before
-- consent, so the Capital Craft team can reach the lead owner directly.
-- Shown on the profile identity card / Task Manager drawer alongside the name.
--
-- Rollback: alter table epc_applications drop column if exists lead_owner_phone;
-- =========================================================

alter table epc_applications
  add column if not exists lead_owner_phone text;
