-- =========================================================
-- 0055 — Dynamic lender registry
--   (1) lenders (new table) — the global list of lending partners.
--       Seeded with the existing three (aerem, creditfair, solfin).
--       Admins can add more at runtime from the EPC dashboard, and a
--       new lender then appears (with its own docs/approved/rejected
--       ticks) on EVERY EPC's lender dropdown.
--   (2) epc_lender_status.lender — drop the hardcoded 3-value CHECK
--       and replace it with an FK to lenders.key so any REGISTERED
--       lender key is valid (and only those).
--
-- Additive + non-destructive: the three seed keys already satisfy the
-- FK, so existing epc_lender_status rows are untouched. Admin-only RLS,
-- exactly like epc_lender_status — invisible to EPCs.
--
-- Rollback:
--   alter table epc_lender_status drop constraint if exists epc_lender_status_lender_fkey;
--   alter table epc_lender_status add constraint epc_lender_status_lender_check
--     check (lender in ('creditfair','aerem','solfin'));
--   drop trigger if exists trg_lenders_updated on lenders;
--   drop table if exists lenders;
-- =========================================================

-- ── (1) lenders registry ────────────────────────────────────
create table if not exists lenders (
  key         text primary key,
  label       text not null,
  sort_order  int  not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into lenders (key, label, sort_order) values
  ('aerem',      'Aerem',       10),
  ('creditfair', 'Credit Fair', 20),
  ('solfin',     'Solfin',      30)
on conflict (key) do nothing;

alter table lenders enable row level security;

-- ADMIN-ONLY, consistent with epc_lender_status. NO EPC policy.
drop policy if exists "admin_all_lenders" on lenders;
create policy "admin_all_lenders" on lenders for all
  using ((auth.jwt() ->> 'business_type') = 'admin');

drop trigger if exists trg_lenders_updated on lenders;
create trigger trg_lenders_updated
  before update on lenders
  for each row execute function set_updated_at();


-- ── (2) swap the fixed CHECK for an FK to the registry ──────
-- The inline CHECK from 0012 is auto-named epc_lender_status_lender_check.
alter table epc_lender_status
  drop constraint if exists epc_lender_status_lender_check;

alter table epc_lender_status
  drop constraint if exists epc_lender_status_lender_fkey;
alter table epc_lender_status
  add constraint epc_lender_status_lender_fkey
  foreign key (lender) references lenders (key) on update cascade;
