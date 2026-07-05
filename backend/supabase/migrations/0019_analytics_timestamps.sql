-- =========================================================
-- 0019 — Analytics timestamps
--
-- Additive columns to power the /admin/analytics dashboard.
-- All new columns are NULLABLE and there is NO historical
-- backfill. The 37 existing EPCs remain NULL on these columns
-- and are excluded from every metric. Charts populate as new
-- EPCs move through the pipeline.
--
-- Columns added:
--   epc_business.reviewed_at        (timestamptz) — first admin
--       status change from under_review → approved/on_hold/rejected
--   epc_business.step_timestamps    (jsonb)      — per-step completion
--       shape: { step_1_completed_at, …, step_6_completed_at }
--       Stamped by trg_stamp_step_completion on current_step advance.
--       First-write wins — going back to an earlier step never resets.
--   epc_lender_status.docs_given_at (timestamptz) — first flip true
--   epc_lender_status.approved_at   (timestamptz) — first flip true
--
-- Triggers:
--   trg_stamp_step_completion — BEFORE UPDATE on epc_business.
--       When current_step advances (old→new, new>old), stamps
--       step_(new-1)_completed_at into step_timestamps if not
--       already present. Zero frontend changes needed — every
--       step-N save that bumps current_step gets recorded.
--   trg_stamp_lender_status_ts — BEFORE INSERT/UPDATE on
--       epc_lender_status. First-flip stamps for docs_given /
--       approved. Both toggle sites (admin/page.tsx list AND
--       View-page) are covered by the DB layer.
--
-- Rollback:
--   drop trigger if exists trg_stamp_lender_status_ts on epc_lender_status;
--   drop function if exists stamp_lender_status_timestamps();
--   drop trigger if exists trg_stamp_step_completion on epc_business;
--   drop function if exists stamp_step_completion();
--   alter table epc_lender_status drop column if exists approved_at;
--   alter table epc_lender_status drop column if exists docs_given_at;
--   alter table epc_business drop column if exists step_timestamps;
--   alter table epc_business drop column if exists reviewed_at;
-- =========================================================


-- ── epc_business: reviewed_at + step_timestamps ─────────────
alter table epc_business
  add column if not exists reviewed_at timestamptz;

alter table epc_business
  add column if not exists step_timestamps jsonb not null default '{}'::jsonb;


-- ── epc_lender_status: docs_given_at + approved_at ──────────
alter table epc_lender_status
  add column if not exists docs_given_at timestamptz,
  add column if not exists approved_at   timestamptz;


-- ── Trigger: stamp step_(N-1)_completed_at on advance ───────
-- Fires when current_step increases. Records the completion
-- timestamp for the step the EPC just finished. First-write
-- wins — if the same key already exists in step_timestamps,
-- do not overwrite. This means going back to an earlier step
-- via self-edit will not clobber the original completion time.
create or replace function stamp_step_completion() returns trigger as $$
declare
  completed_step int;
  key text;
begin
  if new.current_step is distinct from old.current_step
     and new.current_step > old.current_step then
    completed_step := new.current_step - 1;
    if completed_step between 1 and 6 then
      key := 'step_' || completed_step || '_completed_at';
      if not (new.step_timestamps ? key) then
        new.step_timestamps := new.step_timestamps
          || jsonb_build_object(key, to_jsonb(now()));
      end if;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_stamp_step_completion on epc_business;
create trigger trg_stamp_step_completion
  before update on epc_business
  for each row execute function stamp_step_completion();


-- ── Trigger: stamp first-flip on the lender flags ───────────
-- Semantics: docs_given_at / approved_at are set to now() the
-- FIRST time the corresponding flag is true. Un-tick + re-tick
-- does NOT reset them — the "when did it first happen" answer
-- is what the metrics care about.
create or replace function stamp_lender_status_timestamps() returns trigger as $$
begin
  if new.docs_given = true and new.docs_given_at is null then
    new.docs_given_at := now();
  end if;
  if new.approved = true and new.approved_at is null then
    new.approved_at := now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_stamp_lender_status_ts on epc_lender_status;
create trigger trg_stamp_lender_status_ts
  before insert or update on epc_lender_status
  for each row execute function stamp_lender_status_timestamps();
