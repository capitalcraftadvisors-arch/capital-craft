-- =========================================================
-- 0047 — Insurance refinements.
--
-- (1) STATUS SET → draft | under_review | issued | rejected | hold
--     The 0046 set was draft|submitted|under_review|approved|rejected, and the
--     submit route writes 'submitted'. Both 'submitted' and 'approved' are gone
--     from the new set, so existing rows are MIGRATED first (otherwise the new
--     CHECK would fail to validate):
--         submitted -> under_review   (submitted == awaiting our review)
--         approved  -> issued         (the policy is issued)
--     The submit route is updated in the same release to write 'under_review'.
--
-- (2) SUM INSURED — auto-tagged from the captured final-invoice amount. Stored
--     as a real column (not derived) so the dashboards can sort/filter on it and
--     so an admin can override it later without touching the invoice record.
--     Backfilled from the confirmed amount, falling back to the OCR amount.
--
-- (3) INSURANCE PARTNER — 'SBI' is the only partner today, but it's a field (not
--     a hardcoded string) so more can be added without a migration.
--
-- (4) THREE GEO-TAGGED PHOTOS — customer with panel / inverter / meter. These are
--     *_path + *_gps COLUMNS, not user_application_docs rows, so there are NO new
--     enum values to add (insurance docs have always lived as column paths).
--     The old single plant_photo_* columns are LEFT IN PLACE (unused going
--     forward) so nothing already uploaded is lost.
--
-- Rollback:
--   alter table insurance_applications
--     drop column if exists sum_insured,
--     drop column if exists insurance_partner,
--     drop column if exists photo_panel_path,    drop column if exists photo_panel_gps,
--     drop column if exists photo_inverter_path, drop column if exists photo_inverter_gps,
--     drop column if exists photo_meter_path,    drop column if exists photo_meter_gps;
--   alter table insurance_applications drop constraint if exists insurance_applications_status_check;
--   alter table insurance_applications add constraint insurance_applications_status_check
--     check (status in ('draft','submitted','under_review','approved','rejected'));
-- =========================================================

-- ── (1) Status: migrate data BEFORE swapping the constraint ──
alter table insurance_applications
  drop constraint if exists insurance_applications_status_check;

update insurance_applications set status = 'under_review' where status = 'submitted';
update insurance_applications set status = 'issued'       where status = 'approved';

alter table insurance_applications
  add constraint insurance_applications_status_check
  check (status in ('draft', 'under_review', 'issued', 'rejected', 'hold'));

-- ── (2) Sum insured ──────────────────────────────────────
alter table insurance_applications
  add column if not exists sum_insured numeric;

comment on column insurance_applications.sum_insured is
  'Auto-tagged from the confirmed final-invoice amount on Step 2. Admin-editable.';

update insurance_applications
   set sum_insured = coalesce(invoice_confirmed_amount, invoice_amount)
 where sum_insured is null
   and coalesce(invoice_confirmed_amount, invoice_amount) is not null;

-- ── (3) Insurance partner ────────────────────────────────
alter table insurance_applications
  add column if not exists insurance_partner text not null default 'SBI';

comment on column insurance_applications.insurance_partner is
  'Underwriting partner. SBI is the only one today; kept as a field so more can be added.';

-- ── (4) The three geo-tagged photos ──────────────────────
alter table insurance_applications
  add column if not exists photo_panel_path     text,
  add column if not exists photo_panel_gps      jsonb,
  add column if not exists photo_inverter_path  text,
  add column if not exists photo_inverter_gps   jsonb,
  add column if not exists photo_meter_path     text,
  add column if not exists photo_meter_gps      jsonb;

comment on column insurance_applications.photo_panel_path is
  'Customer with panel — geo-tagged (upload only; GPS read client-side before compression).';
