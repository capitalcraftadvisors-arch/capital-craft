-- 0079_epc_score_and_reject_reason.sql
--
-- (1) Capital Craft EPC Score. An admin manually rates each EPC on nine
--     criteria (1–5 stars each); the /100 total is derived from those stars.
--     epc_score  = jsonb { application_quality, approval_ratio, cancellation_ratio,
--                          document_quality, installation_tat, second_tranche,
--                          customer_complaints, transaction_volume, repeat_business,
--                          total, rated_by_name, rated_at }
--     epc_score_total = the /100 integer, duplicated as a plain column so the
--     dashboard list can show/sort it without parsing the jsonb.
-- (2) EPC rejection reason (chosen from a dropdown when an admin rejects an EPC).
--
-- All three columns live on epc_business, which is admin-only for writes via the
-- existing RLS policy; no new policy needed.

alter table public.epc_business
  add column if not exists epc_score jsonb,
  add column if not exists epc_score_total integer,
  add column if not exists rejection_reason text;
