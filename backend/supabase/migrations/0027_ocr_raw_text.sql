-- =========================================================
-- 0027 — OCR raw-text debug column on epc_applications.
--
-- Persists the RAW OCR text Vision returned for every extraction on
-- the loan application, keyed by doc type. Enables server-side debug
-- when the field parsers miss (see the "share the doc so I can tune
-- the regex" flow).
--
-- Shape of ocr_raw_text:
--   {
--     "aadhaar_front":  "…raw OCR text…",
--     "aadhaar_back":   "…",
--     "coapp_pan":      "…",
--     "proforma":       "…",
--     "ebill":          "…",
--     "bank_statement": "…"
--   }
-- Keys are added lazily by the extract-* routes via the append_ocr_raw
-- function below. Missing keys mean that doc type wasn't extracted yet.
--
-- Additive column with an empty-object default. No backfill needed —
-- existing rows start with {} and populate as new extractions run.
-- =========================================================


-- ── The column ───────────────────────────────────────────────
alter table epc_applications
  add column if not exists ocr_raw_text jsonb not null default '{}'::jsonb;


-- ── Atomic merge helper ──────────────────────────────────────
-- Merges a single key/value into ocr_raw_text without a fetch-then-write
-- round trip in the app code. Called via .rpc('append_ocr_raw', {...})
-- from the 4 extract-* API routes.
--
-- Safe under concurrent updates: uses jsonb || which is atomic within a
-- single UPDATE statement.
create or replace function append_ocr_raw(
  app_id      uuid,
  key_name    text,
  raw_text    text
) returns void as $$
begin
  update epc_applications
     set ocr_raw_text = coalesce(ocr_raw_text, '{}'::jsonb)
                       || jsonb_build_object(key_name, raw_text)
   where id = app_id;
end;
$$ language plpgsql;


-- =========================================================
-- Rollback:
--   drop function if exists append_ocr_raw(uuid, text, text);
--   alter table epc_applications drop column if exists ocr_raw_text;
-- =========================================================
