-- =========================================================
-- 0048 — Disbursement: three geo-tagged completion photos.
--
-- The disbursement completion set changes from a single geo photo
-- ('completion_plant_photo') to three specific ones. These are
-- user_application_docs rows, so the category is the loan_doc_category ENUM
-- and needs new values. Enum ADD VALUE can't be used in the same transaction
-- that references it, so — like 0043 / 0005 — this lives in its own migration.
--
-- After this, the completion set is:
--   completion_invoice          (invoice / tax invoice)
--   completion_panel_photo      (customer with panel)     <-- new
--   completion_inverter_photo   (customer with inverter)  <-- new
--   completion_meter_photo      (customer with meter)     <-- new
--   completion_report           (work completion / commission report)
--
-- completion_plant_photo is NOT dropped (Postgres can't drop an enum value):
-- any photo already uploaded under it keeps its user_application_docs row and
-- GCS object, is still swept into the loan ZIP (which walks all docs), and is
-- surfaced read-only in the UI as a legacy photo. The new flow simply stops
-- writing that category.
--
-- Rollback: enum values are additive and inert if unused; nothing to undo.
-- =========================================================

alter type loan_doc_category add value if not exists 'completion_panel_photo';
alter type loan_doc_category add value if not exists 'completion_inverter_photo';
alter type loan_doc_category add value if not exists 'completion_meter_photo';
