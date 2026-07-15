-- =========================================================
-- 0043 — Add the 3 completion-document categories to loan_doc_category.
--
-- Why a dedicated migration (same reasoning as 0005 for epc_doc_category):
--   ALTER TYPE ... ADD VALUE has restrictions about using the newly-added
--   value in the SAME transaction. Keeping these statements isolated in
--   their own migration file guarantees later migrations (0044) — and the
--   app — can reference the new values freely.
--
-- These are the 3 docs collected after the FIRST disbursement, to unlock
-- the SECOND. Uploaded by EITHER the admin (on behalf) or the EPC — the
-- slots are shared on the application, so the category is the same either
-- way and user_application_docs' existing RLS already lets both write:
--   own_app_docs   -> EPC, for applications of their own business
--   admin_all_app_docs -> admin, for any application
--
-- After this migration the enum contains:
--   borrower_pan, borrower_aadhaar, borrower_photo, bank_statement,
--   income_proof, electricity_bill, property_doc, quotation, other,
--   completion_invoice, completion_plant_photo, completion_report  <-- new
--
-- Rollback: Postgres cannot DROP an enum value. To undo you'd have to
-- recreate the type. These values are additive and inert if unused.
-- =========================================================

alter type loan_doc_category add value if not exists 'completion_invoice';
alter type loan_doc_category add value if not exists 'completion_plant_photo';
alter type loan_doc_category add value if not exists 'completion_report';
