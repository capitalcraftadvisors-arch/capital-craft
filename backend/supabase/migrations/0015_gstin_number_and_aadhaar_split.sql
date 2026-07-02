-- =========================================================
-- 0015 — Big-batch: gstin_number column + Aadhaar front/back split
--
-- (1) epc_business.gstin_number — 15-char GSTIN, auto-filled by
--     extract-gst-legalname OCR, editable in Step 2 (draft-required)
--     and in the admin EPC detail page.
--
-- (2) Two new epc_doc_category enum values so member Aadhaar can
--     upload as two separate slots (front + back).  Legacy
--     stakeholder_aadhaar remains a valid enum member — existing
--     rows on the 40 legacy EPCs continue to read fine; the admin
--     detail page renders them as a "Legacy Aadhaar" slot alongside
--     the new front/back slots. New onboarding writes to the split
--     categories.
--
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS is idempotent. This
-- migration does NOT use the new values in the same transaction,
-- so it runs cleanly through supabase db push.
--
-- Rollback:
--    alter table epc_business drop column if exists gstin_number;
--    -- Postgres enum values cannot be dropped once added; a full
--    -- rollback would require creating a new type + swapping. Not
--    -- worth it for two additive values.
-- =========================================================

alter table epc_business
  add column if not exists gstin_number text;

alter type epc_doc_category add value if not exists 'stakeholder_aadhaar_front';
alter type epc_doc_category add value if not exists 'stakeholder_aadhaar_back';
