-- =========================================================
-- 0036 — Loan applicant display ID: CC-RES-<seq> / CC-COM-<seq>
--
-- Replaces the LA-<last5 mobile>-<seq> format (0030) with a format keyed
-- on the Residential/Commercial plant-use choice (0031):
--   plant_use_type = 'residential' -> CC-RES-00001
--   plant_use_type = 'commercial'  -> CC-COM-00001
--
-- SEPARATE sequences per type (each counts independently from 00001), so
-- the running number reads cleanly within its own category. A Postgres
-- SEQUENCE guarantees atomic, collision-free numbering under concurrency.
--
-- TIMING: the id is assigned at the FIRST write where plant_use_type is
-- present, then FROZEN (never regenerated — editing plant_use_type later
-- does NOT change the id). The EPC apply flow sets plant_use_type at the
-- INSERT (register); the admin flow sets it on the Step-1 UPDATE. The
-- trigger handles both because it fires BEFORE INSERT OR UPDATE.
--
-- NO BACKFILL: the current loan applicants are dummy rows that will be
-- deleted before go-live, so old LA- ids are left as-is until then and no
-- CC- ids are minted for them. The loan_display_id column (unique, 0030)
-- is reused.
--
-- Rollback (restores nothing automatically — 0030 would need re-running):
--   drop trigger if exists trg_loan_display_id on epc_applications;
--   drop function if exists assign_loan_display_id();
--   drop sequence if exists loan_res_seq;
--   drop sequence if exists loan_com_seq;
-- =========================================================

-- ── Drop the old LA- generator (column loan_display_id is reused) ──
drop trigger  if exists trg_loan_display_id on epc_applications;
drop function if exists assign_loan_display_id();
drop function if exists loan_format_display_id(text, bigint);
-- loan_display_last5 is now unused but harmless; drop for tidiness.
drop function if exists loan_display_last5(text);

-- ── Per-type sequences ────────────────────────────────────────────
create sequence if not exists loan_res_seq;
create sequence if not exists loan_com_seq;

-- ── Trigger: assign once, when plant_use_type first exists ─────────
create or replace function assign_loan_display_id() returns trigger as $$
begin
  if new.loan_display_id is null
     and new.plant_use_type in ('residential', 'commercial') then
    if new.plant_use_type = 'residential' then
      new.loan_display_id := 'CC-RES-' || lpad(nextval('loan_res_seq')::text, 5, '0');
    else
      new.loan_display_id := 'CC-COM-' || lpad(nextval('loan_com_seq')::text, 5, '0');
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_loan_display_id on epc_applications;
create trigger trg_loan_display_id
  before insert or update on epc_applications
  for each row execute function assign_loan_display_id();
