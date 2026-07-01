-- =========================================================
-- 0014 — Batch 1: admin-only EPC business info
--
-- Four fields the admin fills during EPC review:
--   1. team_size                     (text; freeform: "50" or "50 (30T + 20NT)")
--   2. capacity_residential + unit   (numeric + 'KW'|'MW')
--   3. capacity_commercial + unit    (numeric + 'KW'|'MW')
--   4. turnover_last_fy              (text; freeform: "5 Cr" or "50000000")
--
-- Storage: SEPARATE TABLE, not columns on epc_business. Rationale:
-- epc_business has an own_business RLS policy that grants EPCs SELECT
-- on their own row, including any new columns. A separate admin-only
-- table with NO EPC policy is invisible to non-admin JWTs. Same pattern
-- as epc_lender_status.
--
-- One row per EPC (business_id is PK). Row is LAZY — created on first
-- Save. Missing row means all fields are null.
--
-- Rollback:
--    drop trigger if exists trg_epc_admin_info_updated on epc_admin_info;
--    drop table if exists epc_admin_info;
-- =========================================================

create table if not exists epc_admin_info (
  business_id                uuid primary key
                                references epc_business(id) on delete cascade,
  team_size                  text,
  capacity_residential       numeric,
  capacity_residential_unit  text check (capacity_residential_unit in ('KW', 'MW')),
  capacity_commercial        numeric,
  capacity_commercial_unit   text check (capacity_commercial_unit in ('KW', 'MW')),
  turnover_last_fy           text,
  updated_at                 timestamptz not null default now()
);

alter table epc_admin_info enable row level security;

create policy "admin_all_epc_admin_info" on epc_admin_info for all
  using ((auth.jwt() ->> 'business_type') = 'admin');
-- NO EPC policy — invisible to EPCs.

drop trigger if exists trg_epc_admin_info_updated on epc_admin_info;
create trigger trg_epc_admin_info_updated
  before update on epc_admin_info
  for each row execute function set_updated_at();
