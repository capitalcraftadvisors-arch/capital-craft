-- =========================================================
-- 0033 — Applicant passport photo on the loan application
--
-- Adds a dedicated document category for the applicant's passport-size
-- photo (distinct from borrower_photo, which the rooftop upload uses)
-- plus a column on the application row so the View page can surface it
-- alongside the other docs.
--
-- Captured on the REGISTRATION step of both flows (admin Step 1 and the
-- EPC apply Page 1). Nullable — existing applications stay valid.
--
-- NOTE: `alter type ... add value` only ADDS the label; nothing in this
-- migration USES it, so it is safe to run inside the migration
-- transaction on Postgres 12+.
--
-- Rollback (enum values can't be dropped — leave the label):
--   alter table epc_applications drop column if exists customer_photo_path;
-- =========================================================

alter type loan_doc_category add value if not exists 'customer_photo';

alter table epc_applications
  add column if not exists customer_photo_path text;
