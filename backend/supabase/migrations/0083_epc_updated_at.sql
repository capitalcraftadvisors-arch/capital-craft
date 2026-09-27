-- 0083 — EPC "Updated" status signal.
--
-- Set to now() when the EPC edits & RESUBMITS an already-submitted loan
-- application (not the first submit). Powers the portal's distinct "Updated"
-- status (vs "Under review") and feeds the "most-recent status change" sort.
-- Additive + nullable — safe on existing rows.
alter table public.epc_applications
  add column if not exists epc_updated_at timestamptz;
