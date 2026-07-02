-- =========================================================
-- 0017 — Decouple admin status from EPC loan-app access
--
-- Adds two booleans + a stored generated column on epc_business:
--   loan_app_grandfathered  — durable flag set for EPCs that had
--                              status='approved' at deploy time. Once
--                              true, always true — never cleared by
--                              any subsequent status/lender change.
--   has_lender_approval     — maintained by a trigger on
--                              epc_lender_status. True iff any lender
--                              row for this EPC has approved=true.
--   loan_app_unlocked       — stored generated column:
--                              grandfathered OR has_lender_approval.
--                              This is the ONE boolean the EPC's
--                              client reads to decide dashboard access.
--
-- Also: BEFORE INSERT trigger on epc_applications enforces the gate
-- server-side (admins bypass; EPCs blocked unless loan_app_unlocked).
--
-- epc_business.status stays intact for admin tracking — it's now an
-- internal-only field, never exposed to EPCs.
--
-- Rollback:
--   drop trigger if exists trg_enforce_loan_app_gate on epc_applications;
--   drop function if exists enforce_loan_app_gate();
--   drop trigger if exists trg_epc_lender_status_sync on epc_lender_status;
--   drop function if exists trg_lender_status_sync();
--   drop function if exists recompute_lender_approval(uuid);
--   alter table epc_business drop column if exists loan_app_unlocked;
--   alter table epc_business drop column if exists has_lender_approval;
--   alter table epc_business drop column if exists loan_app_grandfathered;
-- =========================================================

alter table epc_business
  add column if not exists loan_app_grandfathered boolean not null default false;

alter table epc_business
  add column if not exists has_lender_approval boolean not null default false;

alter table epc_business
  add column if not exists loan_app_unlocked boolean
    generated always as (loan_app_grandfathered or has_lender_approval) stored;

-- ── Trigger maintains has_lender_approval from epc_lender_status ────
create or replace function recompute_lender_approval(bid uuid) returns void as $$
begin
  update epc_business b
     set has_lender_approval = exists(
       select 1 from epc_lender_status l
        where l.business_id = bid and l.approved = true
     )
   where b.id = bid;
end;
$$ language plpgsql;

create or replace function trg_lender_status_sync() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    perform recompute_lender_approval(old.business_id);
    return old;
  else
    perform recompute_lender_approval(new.business_id);
    if tg_op = 'UPDATE' and new.business_id <> old.business_id then
      perform recompute_lender_approval(old.business_id);
    end if;
    return new;
  end if;
end;
$$ language plpgsql;

drop trigger if exists trg_epc_lender_status_sync on epc_lender_status;
create trigger trg_epc_lender_status_sync
  after insert or update or delete on epc_lender_status
  for each row execute function trg_lender_status_sync();

-- ── Backfill has_lender_approval for anyone already approved ────────
update epc_business b
   set has_lender_approval = true
 where exists(select 1 from epc_lender_status l
                where l.business_id = b.id and l.approved = true);

-- ── GRANDFATHER: every EPC currently status='approved' ─────────────
-- Runs ONCE at migration time. All these EPCs keep loan-app access
-- permanently, regardless of any future status or lender changes.
update epc_business
   set loan_app_grandfathered = true
 where status = 'approved';

-- ── Server-side gate on epc_applications creation ──────────────────
create or replace function enforce_loan_app_gate() returns trigger as $$
begin
  -- Admins bypass (admin JWT has business_type='admin').
  if (auth.jwt() ->> 'business_type') = 'admin' then
    return new;
  end if;
  -- Service-role bypass (background jobs, if any).
  if auth.role() = 'service_role' then
    return new;
  end if;
  -- EPCs: business row must have loan_app_unlocked = true.
  if not exists(
    select 1 from epc_business b
     where b.id = new.epc_business_id
       and b.loan_app_unlocked = true
  ) then
    raise exception 'loan_app_locked_for_business' using errcode = '42501';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_enforce_loan_app_gate on epc_applications;
create trigger trg_enforce_loan_app_gate
  before insert on epc_applications
  for each row execute function enforce_loan_app_gate();
