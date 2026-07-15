-- =========================================================
-- 0042 — Loan approval / rejection + per-step loan activity log
--
-- PART A — approval / rejection on epc_applications
--   approved_lender / rejected_lender : which of the 3 lenders decided
--   approved_at / rejected_at         : when
--   approval_details                  : jsonb payload of the approval table
--                                       the admin fills after choosing a lender
--
-- approval_details shape (mirrors the ApprovalDetailsTable component):
--   {
--     "approved_by":           "aerem" | "solfin" | "creditfair",
--     "applied_loan_amount":   <number|null>,   -- snapshot at approval time
--     "approved_loan_amount":  <number|null>,
--     "applied_tenure_years":  <number|null>,   -- snapshot
--     "approved_tenure_years": <number|null>,
--     "tentative_emi":         <number|null>,   -- snapshot
--     "approved_emi":          <number|null>
--   }
-- Filled ONCE per application and rendered read-only on the View page.
-- Stored as jsonb so the table's fields can change without a migration.
--
-- PART B — loan_activity_log
--   admin_edit_log is keyed to business_id -> epc_business and has NO loan
--   key, so loan events can't live there without either loosening that FK or
--   filing loan events against the parent EPC (which would pollute the EPC's
--   activity log). A separate application-keyed table keeps them clean —
--   same reasoning as loan_comments (0041), same row shape as admin_edit_log.
--
-- Rollback:
--   drop table if exists loan_activity_log;
--   alter table epc_applications
--     drop column if exists approved_lender,
--     drop column if exists rejected_lender,
--     drop column if exists approved_at,
--     drop column if exists rejected_at,
--     drop column if exists approval_details;
-- =========================================================

-- ── PART A ───────────────────────────────────────────────
alter table epc_applications
  add column if not exists approved_lender  text,
  add column if not exists rejected_lender  text,
  add column if not exists approved_at      timestamptz,
  add column if not exists rejected_at      timestamptz,
  add column if not exists approval_details jsonb;

-- Same 3 lenders as epc_lender_status. Null allowed (no decision yet).
alter table epc_applications
  drop constraint if exists epc_applications_approved_lender_check;
alter table epc_applications
  add constraint epc_applications_approved_lender_check
  check (approved_lender is null or approved_lender in ('creditfair', 'aerem', 'solfin'));

alter table epc_applications
  drop constraint if exists epc_applications_rejected_lender_check;
alter table epc_applications
  add constraint epc_applications_rejected_lender_check
  check (rejected_lender is null or rejected_lender in ('creditfair', 'aerem', 'solfin'));

comment on column epc_applications.approval_details is
  'Admin-filled approval table (jsonb). Written once when a lender approves; read-only in the View.';

-- ── PART B ───────────────────────────────────────────────
create table if not exists loan_activity_log (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references epc_applications(id) on delete cascade,
  actor          text not null,          -- 'admin' | 'epc'
  actor_id       uuid,                   -- actor's epc_business.id
  actor_name     text,                   -- snapshot of the actor's name
  action         text not null,          -- step_completed | submitted | approved
                                         -- | rejected | status_change | field_edit
  step           smallint,               -- 1..6 when action = 'step_completed'
  detail         text,                   -- free-text extra (lender, note, field)
  created_at     timestamptz not null default now()
);

create index if not exists idx_loan_activity_application
  on loan_activity_log (application_id, created_at desc);

alter table loan_activity_log enable row level security;

-- ADMIN ONLY. Every writer today (the complete-step-N routes and the View's
-- approve/reject actions) runs under an admin JWT. No EPC policy → invisible
-- to EPCs. Add an EPC insert policy here if the EPC-facing loan flow ever
-- needs to log.
create policy "admin_all_loan_activity_log" on loan_activity_log for all
  using ((auth.jwt() ->> 'business_type') = 'admin');
