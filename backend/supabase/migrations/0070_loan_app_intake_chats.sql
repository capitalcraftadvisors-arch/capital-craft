-- =========================================================
-- 0070 — AI intake chat persistence
--
-- Stores the transcript + collected form state + cursor for the AI intake
-- concierge (admin/app/intake) so a half-finished application can be REOPENED
-- and the chat resumes exactly where the RM left off. One row per application.
--
-- The transcript is the exact message list the chat renders (bot/user bubbles,
-- document receipts, timestamps); form_state is the accumulated field map the
-- chat has gathered; cursor is the script index to resume from.
--
-- Admin-only (same posture as loan_leads / epc_applications admin access).
-- On application delete the chat row is removed with it.
--
-- Rollback:
--   drop table if exists loan_app_intake_chats;
-- =========================================================

create table if not exists loan_app_intake_chats (
  application_id       uuid primary key references epc_applications(id) on delete cascade,
  transcript           jsonb  not null default '[]'::jsonb,
  form_state           jsonb  not null default '{}'::jsonb,
  cursor               smallint not null default 0,
  mode                 text   not null default 'create' check (mode in ('create','edit')),
  updated_at           timestamptz not null default now(),
  updated_by_user_id   uuid
);

alter table loan_app_intake_chats enable row level security;

drop policy if exists loan_app_intake_chats_admin_all on loan_app_intake_chats;
create policy loan_app_intake_chats_admin_all on loan_app_intake_chats
  for all to authenticated
  using (auth.jwt() ->> 'business_type' = 'admin')
  with check (auth.jwt() ->> 'business_type' = 'admin');

create index if not exists loan_app_intake_chats_updated_idx
  on loan_app_intake_chats (updated_at desc);
