-- =========================================================
-- 0077 — Ops case "touch": per-case follow-up + last-contacted
--
-- Powers the Task Manager / My Day:
--   • follow_up_at      — "call back on <date>"; the case resurfaces in My Day
--                         flagged due-today / overdue.
--   • last_contacted_at — stamped when an RM calls / WhatsApps a case, so rows
--                         show "contacted Nd ago" and un-contacted sort first.
--
-- One SHARED side table keyed by (source, case_id) so all four case types
-- (loan / insurance / lead / epc) live in one place — no need to alter four
-- tables. Additive and safe: existing code that never reads it is unaffected.
-- =========================================================

create table if not exists ops_case_touch (
  source            text not null check (source in ('loan','insurance','lead','epc')),
  case_id           uuid not null,
  follow_up_at      date,
  last_contacted_at timestamptz,
  updated_by        uuid,            -- admin business row id (snapshot, nullable)
  updated_at        timestamptz not null default now(),
  primary key (source, case_id)
);

alter table ops_case_touch enable row level security;

-- Admin-console users only (same gate as loan_comments). SELECT / INSERT /
-- UPDATE — a case's touch row is written repeatedly (unlike immutable comments),
-- so UPDATE is allowed; no DELETE (clear a follow-up by setting it null).
create policy "admin_select_ops_case_touch" on ops_case_touch for select
  using ((auth.jwt() ->> 'business_type') = 'admin');
create policy "admin_insert_ops_case_touch" on ops_case_touch for insert
  with check ((auth.jwt() ->> 'business_type') = 'admin');
create policy "admin_update_ops_case_touch" on ops_case_touch for update
  using ((auth.jwt() ->> 'business_type') = 'admin')
  with check ((auth.jwt() ->> 'business_type') = 'admin');

-- Cheap lookup of everything due (My Day) without scanning nulls.
create index if not exists ops_case_touch_followup_idx
  on ops_case_touch (follow_up_at) where follow_up_at is not null;
