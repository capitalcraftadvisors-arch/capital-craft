-- =========================================================
-- 0030 — Loan applicant display ID: LA-<last5 mobile>-<5-digit seq>
--
-- Same pattern as epc_display_id (0016): a Postgres SEQUENCE gives a
-- guaranteed-unique, atomic running number; the formatted id is
-- frozen into a UNIQUE column and never changes afterwards.
--
-- TIMING NUANCE vs the EPC version: an epc_business row is born with
-- its mobile (login key), but a loan application is created with only
-- the EPC link — borrower_mobile arrives when Step 1 completes. So
-- the trigger assigns the id at the FIRST write that has a mobile
-- (insert or update), not strictly at insert. Once set it is never
-- regenerated — editing the mobile later does NOT change the id.
--
-- NO DOB in the id (privacy) — spec'd explicitly.
--
-- created_by ('epc' | 'admin', from 0001) already records who created
-- the application — no new column needed for the dashboard's BY field.
--
-- Rollback:
--   drop trigger if exists trg_loan_display_id on epc_applications;
--   drop function if exists assign_loan_display_id();
--   drop function if exists loan_format_display_id(text, bigint);
--   alter table epc_applications drop column if exists loan_display_id;
--   drop sequence if exists loan_display_seq;
-- =========================================================


-- ── Sequence + column ────────────────────────────────────────
create sequence if not exists loan_display_seq;

alter table epc_applications
  add column if not exists loan_display_id text unique;


-- ── Formatter ────────────────────────────────────────────────
-- last5 of the mobile + zero-padded sequence.
--   loan_format_display_id('9252102705', 1) -> 'LA-02705-00001'
create or replace function loan_display_last5(mobile text) returns text as $$
  select lpad(right(regexp_replace(coalesce(mobile, ''), '\D', '', 'g'), 5), 5, '0');
$$ language sql immutable;

create or replace function loan_format_display_id(mobile text, seq bigint) returns text as $$
  select 'LA-' || loan_display_last5(mobile) || '-' || lpad(seq::text, 5, '0');
$$ language sql immutable;


-- ── Trigger: assign once, when a mobile first exists ─────────
create or replace function assign_loan_display_id() returns trigger as $$
begin
  if new.loan_display_id is null
     and new.borrower_mobile is not null
     and length(regexp_replace(new.borrower_mobile, '\D', '', 'g')) >= 5 then
    new.loan_display_id := loan_format_display_id(
      new.borrower_mobile,
      nextval('loan_display_seq')
    );
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_loan_display_id on epc_applications;
create trigger trg_loan_display_id
  before insert or update on epc_applications
  for each row execute function assign_loan_display_id();


-- ── Backfill: existing applications with a mobile, oldest first ──
do $$
declare
  r record;
begin
  for r in
    select id, borrower_mobile
      from epc_applications
     where loan_display_id is null
       and borrower_mobile is not null
       and length(regexp_replace(borrower_mobile, '\D', '', 'g')) >= 5
     order by created_at asc
  loop
    update epc_applications
       set loan_display_id = loan_format_display_id(r.borrower_mobile, nextval('loan_display_seq'))
     where id = r.id;
  end loop;
end $$;
