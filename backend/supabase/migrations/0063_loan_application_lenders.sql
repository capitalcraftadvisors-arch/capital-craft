-- =========================================================
-- 0063 — Per-application, per-lender status + approval details
--
-- Today a loan application carries a SINGLE lender decision (approved_lender /
-- rejected_lender + one set of approval-detail columns on epc_applications).
-- The View-page flow (item 6) needs MANY lenders per application, each with its
-- own timeline (docs-sent / approved / rejected timestamps) and its own
-- approval details, so multiple lenders can approve/reject independently and
-- the dashboard can show the LATEST status by most-recent event.
--
-- This table is additive — the existing single-approval columns stay in place
-- for backward compatibility; the View page reads/writes this table going
-- forward and derives the headline status from the newest timestamp here.
--
-- NOT YET APPLIED to any database (written on the loan-app-lender-flow branch
-- for review; apply only against an isolated dev DB).
--
-- Rollback: drop table if exists loan_application_lenders;
-- =========================================================

create table if not exists loan_application_lenders (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null references epc_applications(id) on delete cascade,
  lender_key        text not null,          -- 'aerem' | 'creditfair' | 'solfin' | custom slug
  lender_label      text not null,          -- display name (e.g. "Credit Fair")

  -- Per-lender event timestamps. Each is set when that event happens for this
  -- lender; the newest across all a lender's/all lenders' events drives status.
  docs_sent_at      timestamptz,
  approved_at       timestamptz,
  rejected_at       timestamptz,
  rejection_reason  text,

  -- Per-lender approval details — the SAME shape as epc_applications.approval_details
  -- (applied-vs-approved amount/tenure/EMI, approved_by, credit_score, sanction
  -- letter refs, …), so each approved lender keeps its own full record and the
  -- Approval Details section can switch between them.
  approval_details      jsonb,
  approval_recorded_at  timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (application_id, lender_key)
);

create index if not exists lal_application_idx on loan_application_lenders (application_id);
-- Newest-event lookup per application for the "latest status" headline.
create index if not exists lal_events_idx on loan_application_lenders (application_id, docs_sent_at, approved_at, rejected_at);

-- keep updated_at fresh
create or replace function touch_loan_application_lenders() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_touch_lal on loan_application_lenders;
create trigger trg_touch_lal
  before update on loan_application_lenders
  for each row execute function touch_loan_application_lenders();

-- ── RLS ────────────────────────────────────────────────────────────
-- Admin-only for writes. EPCs may READ their own application's lender rows
-- (the EPC dashboard still shows the simplified "Approved by lender" state,
-- which is derived from epc_applications.status, but reading here is harmless
-- and future-proofs an EPC-facing per-lender view).
alter table loan_application_lenders enable row level security;

drop policy if exists lal_admin_all on loan_application_lenders;
create policy lal_admin_all on loan_application_lenders
  for all to authenticated
  using (auth.jwt() ->> 'business_type' = 'admin')
  with check (auth.jwt() ->> 'business_type' = 'admin');

drop policy if exists lal_epc_read on loan_application_lenders;
create policy lal_epc_read on loan_application_lenders
  for select to authenticated
  using (
    exists (
      select 1 from epc_applications a
       where a.id = loan_application_lenders.application_id
         and a.epc_business_id::text = (auth.jwt() ->> 'business_id')
    )
  );
