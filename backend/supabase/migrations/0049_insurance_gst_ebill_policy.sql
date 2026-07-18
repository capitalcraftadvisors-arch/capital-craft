-- =========================================================
-- 0049 — Insurance: GST OCR fields, electricity-bill address, policy document.
--
-- All additive, nullable columns on insurance_applications. No enum changes —
-- every document is a *_path column (the pattern the whole insurance track
-- already uses), so nothing already uploaded is affected.
--
--   GST certificate OCR (Step 1, reusing the EPC REG-06 parser):
--     gst_legal_name / gst_trade_name / gstin   — extracted, admin/EPC-editable
--     (gst_path already exists)
--
--   Electricity-bill address (Step 2, reusing the loan e-bill OCR):
--     ebill_path       — the uploaded bill
--     ebill_ocr_raw    — raw Vision text, for debugging
--     (plant_address already exists; the OCR fills it, EPC confirms/edits)
--
--   Insurance policy document (admin View, after SBI issues):
--     policy_path      — the uploaded policy PDF/image
--     policy_from_date / policy_to_date — coverage period (OCR'd, editable)
--     policy_ocr_raw   — raw Vision text, for tuning the parser to the sample
--
-- Rollback:
--   alter table insurance_applications
--     drop column if exists gst_legal_name,
--     drop column if exists gst_trade_name,
--     drop column if exists gstin,
--     drop column if exists ebill_path,
--     drop column if exists ebill_ocr_raw,
--     drop column if exists policy_path,
--     drop column if exists policy_from_date,
--     drop column if exists policy_to_date,
--     drop column if exists policy_ocr_raw;
-- =========================================================

alter table insurance_applications
  add column if not exists gst_legal_name  text,
  add column if not exists gst_trade_name  text,
  add column if not exists gstin           text,
  add column if not exists ebill_path      text,
  add column if not exists ebill_ocr_raw   text,
  add column if not exists policy_path      text,
  add column if not exists policy_from_date date,
  add column if not exists policy_to_date   date,
  add column if not exists policy_ocr_raw   text;

comment on column insurance_applications.policy_from_date is
  'Policy coverage start, OCR''d from the policy document (admin-editable). policy_to_date is the renewal deadline.';
