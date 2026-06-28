-- =========================================================
-- 0010 — Trigger-based enforcement of the EPC self-edit lock.
--
-- Two triggers (one per affected table):
--   * trg_epc_self_edit_lock_business  — fires on UPDATE of epc_business.
--   * trg_epc_self_edit_lock_docs      — fires on INSERT/UPDATE/DELETE
--                                        of epc_documents.
--
-- Both:
--   - Bypass when the caller is admin (auth.jwt() ->> business_type = 'admin').
--   - Bypass when there's no JWT context (service role; e.g. the auth
--     Edge Function's find-or-create insert).
--   - Otherwise, raise check_violation if epc_self_edited is already TRUE.
--
-- Crucially they check OLD state, so the *first* UPDATE that flips
-- epc_self_edited from FALSE → TRUE is allowed (the lock isn't on yet).
-- Every subsequent write by a non-admin caller fails.
-- =========================================================

-- ── epc_business: block non-admin updates after the lock ──────────────
create or replace function enforce_epc_self_edit_lock_business()
returns trigger as $$
declare
  caller_type text;
begin
  caller_type := nullif(auth.jwt() ->> 'business_type', '');
  if caller_type = 'admin' then return new; end if;
  if caller_type is null then return new; end if;   -- service role
  if coalesce(old.epc_self_edited, false) = true then
    raise exception 'epc_self_edited_lock' using errcode = 'check_violation';
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_epc_self_edit_lock_business on epc_business;
create trigger trg_epc_self_edit_lock_business
  before update on epc_business
  for each row execute function enforce_epc_self_edit_lock_business();


-- ── epc_documents: block non-admin writes when related EPC is locked ──
create or replace function enforce_epc_self_edit_lock_docs()
returns trigger as $$
declare
  caller_type text;
  locked      boolean;
  biz_id      uuid;
begin
  caller_type := nullif(auth.jwt() ->> 'business_type', '');
  if caller_type = 'admin' then return coalesce(new, old); end if;
  if caller_type is null then return coalesce(new, old); end if;

  biz_id := coalesce(new.business_id, old.business_id);
  select epc_self_edited into locked from epc_business where id = biz_id;

  if coalesce(locked, false) = true then
    raise exception 'epc_self_edited_lock' using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$ language plpgsql security definer;

drop trigger if exists trg_epc_self_edit_lock_docs on epc_documents;
create trigger trg_epc_self_edit_lock_docs
  before insert or update or delete on epc_documents
  for each row execute function enforce_epc_self_edit_lock_docs();
