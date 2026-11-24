-- 0138 — 2nd-tranche lock + the 2nd-tranche email date (25/11/2026). Needs 0137.
--
--   tranche2_submitted_at  the EPC pressed "Send to Capital Craft" on its 2nd-tranche
--                          page → its 2nd-tranche documents LOCK, like a submitted
--                          loan application (0084).
--   tranche2_allow         the 2nd-tranche documents the Capital Craft team reopened
--                          with Message to EPC, like edit_allow (0085). The EPC's next
--                          Send clears it, so each reopening is single-use.
--   tranche2_emailed_at    when the 2nd-tranche documents last went to the lender —
--                          the Loans list shows it once the 2nd disbursement is in.
--                          Backfilled from the activity log.
--
-- Rules (Capital Craft accounts and the service role are free):
--   user_application_docs  once sent, an EPC can't add or remove a 2nd-tranche
--                          document unless that document was reopened.
--   epc_applications       an EPC can only CLEAR tranche2_allow, can't un-send and
--                          can't touch tranche2_emailed_at; its Send time is the
--                          server's clock.
-- The 2nd-tranche documents = COMPLETION_DOCS + COMPLETION_OTHER (admin/src/lib/disbursement.ts).
--
-- rollback:
--   drop trigger if exists trg_tranche2_lock on user_application_docs;
--   drop function if exists enforce_tranche2_lock();
--   drop trigger if exists trg_tranche2_cols on epc_applications;
--   drop function if exists guard_tranche2_cols();
--   alter table epc_applications drop column if exists tranche2_submitted_at,
--     drop column if exists tranche2_allow, drop column if exists tranche2_emailed_at;

alter table epc_applications
  add column if not exists tranche2_submitted_at timestamptz,
  add column if not exists tranche2_allow        text[] not null default '{}',
  add column if not exists tranche2_emailed_at   timestamptz;

-- A 2nd-tranche document added or removed by an EPC after its Send.
create or replace function enforce_tranche2_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_type text := nullif(auth.jwt() ->> 'business_type', '');
  doc user_application_docs;
  sent timestamptz;
  allow text[];
begin
  if tg_op = 'DELETE' then doc := old; else doc := new; end if;
  if caller_type is null or caller_type = 'admin' then return doc; end if;  -- service role / Capital Craft
  if doc.category::text not in ('completion_invoice', 'completion_panel_photo', 'completion_inverter_photo',
                                'completion_meter_photo', 'completion_report', 'completion_other') then
    return doc;
  end if;
  select a.tranche2_submitted_at, a.tranche2_allow into sent, allow
    from epc_applications a where a.id = doc.application_id;
  if sent is not null and not (doc.category::text = any (coalesce(allow, '{}'))) then
    raise exception 'tranche2_locked' using errcode = 'check_violation';
  end if;
  return doc;
end;
$$;

drop trigger if exists trg_tranche2_lock on user_application_docs;
create trigger trg_tranche2_lock
  before insert or delete on user_application_docs
  for each row execute function enforce_tranche2_lock();

-- The lock columns, written by an EPC.
create or replace function guard_tranche2_cols()
returns trigger
language plpgsql
as $$
declare
  caller_type text := nullif(auth.jwt() ->> 'business_type', '');
begin
  if caller_type is null or caller_type = 'admin' then return new; end if;
  if new.tranche2_emailed_at is distinct from old.tranche2_emailed_at
  or (new.tranche2_allow is distinct from old.tranche2_allow and cardinality(new.tranche2_allow) > 0)
  or (old.tranche2_submitted_at is not null and new.tranche2_submitted_at is null) then
    raise exception 'tranche2_locked' using errcode = 'check_violation';
  end if;
  if new.tranche2_submitted_at is distinct from old.tranche2_submitted_at then
    new.tranche2_submitted_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tranche2_cols on epc_applications;
create trigger trg_tranche2_cols
  before update on epc_applications
  for each row execute function guard_tranche2_cols();

-- When the 2nd-tranche documents were last emailed (the send-to-lender route logs
-- "Emailed completion documents <lender> — <to>") — without touching updated_at.
alter table epc_applications disable trigger trg_epc_applications_updated;

update epc_applications a
   set tranche2_emailed_at = l.at
  from (
    select application_id, max(created_at) as at
      from loan_activity_log
     where action::text = 'email_sent' and detail like 'Emailed completion documents%'
     group by application_id
  ) l
 where l.application_id = a.id;

alter table epc_applications enable trigger trg_epc_applications_updated;
