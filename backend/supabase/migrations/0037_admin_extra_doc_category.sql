-- =========================================================
-- 0037 — 'admin_extra' document category (admin-only extra docs)
--
-- A dedicated category for arbitrary documents an admin attaches on the
-- EPC Edit Profile page, distinct from 'extra_doc' (which is the
-- business-structure document captured during onboarding — Partnership
-- Deed / Certificate of Incorporation / LLP Agreement).
--
-- Multiple rows per business are allowed (no unique index on this
-- category). In the ZIP download these land in a separate "Extra Docs/"
-- folder. The onboarding flow never writes this category — admin only.
--
-- Same additive `add value` pattern as 0005 (gst_r3b) and 0015
-- (stakeholder_aadhaar_front/back). Nothing USES the value in this
-- migration, so it is safe to add.
--
-- Rollback: enum values can't be dropped in Postgres — leave the label.
-- =========================================================

alter type epc_doc_category add value if not exists 'admin_extra';
