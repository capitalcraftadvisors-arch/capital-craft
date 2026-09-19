-- =========================================================
-- 0080 — EPC login events
--
-- One row per successful login (any account). The auth function already stamps
-- epc_business.last_login_at (latest login only); this append-only log lets the
-- analytics EPC-health panel count HOW MANY times partners log in over a window
-- ("Logins / Active EPC"), which a single timestamp can't express.
--
-- Written by the auth Edge Function via the service role (bypasses RLS).
-- Admins read it for analytics; nobody else can.
--
-- Rollback: drop table if exists epc_login_events;
-- =========================================================

create table if not exists epc_login_events (
  id uuid primary key default gen_random_uuid(),
  epc_business_id uuid references epc_business(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists epc_login_events_biz_at_idx
  on epc_login_events (epc_business_id, created_at desc);

alter table epc_login_events enable row level security;

create policy "admin_select_epc_login_events" on epc_login_events for select
  using ((auth.jwt() ->> 'business_type') = 'admin');
