-- =========================================================
-- 0021 — Fix latent FK bug in log_epc_comment_change()
--
-- The trigger from 0018 fires on epc_comments DELETE and writes
-- a 'comment_delete' row into admin_edit_log with business_id set
-- to the parent's business_id. When the parent epc_business row
-- is being deleted (either directly or by cascade), the
-- admin_edit_log.business_id → epc_business(id) FK check fails
-- with:
--   insert or update on table admin_edit_log violates foreign
--   key constraint admin_edit_log_business_id_fkey
--
-- Wrapping the insert in an EXCEPTION handler lets the trigger
-- swallow the violation. A comment_delete audit row would be
-- cascade-deleted along with the parent anyway (0011 declares
-- admin_edit_log.business_id ON DELETE CASCADE), so losing it
-- when the parent is going away is semantically neutral.
--
-- Normal per-row comment deletion (parent still exists) is
-- unaffected: the FK passes and the audit row is written as
-- before.
--
-- Trigger definition itself (trg_epc_comment_log) is unchanged;
-- only the function body is updated via CREATE OR REPLACE.
--
-- Rollback: recreate log_epc_comment_change() with the previous
-- body from 0018_id_prefix_comments_activity.sql:120-155.
-- =========================================================

create or replace function log_epc_comment_change() returns trigger as $$
declare
  jwt_bid  text := (auth.jwt() ->> 'business_id');
  jwt_type text := (auth.jwt() ->> 'business_type');
  actor_id_val uuid;
begin
  if jwt_bid is null then return coalesce(new, old); end if;
  begin
    actor_id_val := jwt_bid::uuid;
  exception when others then
    return coalesce(new, old);
  end;

  if tg_op = 'INSERT' then
    insert into admin_edit_log (business_id, actor, actor_id, action, field, new_value)
      values (new.business_id, coalesce(jwt_type, 'admin'), actor_id_val,
              'comment_add', 'comment', left(new.comment_text, 200));
    return new;

  elsif tg_op = 'UPDATE' then
    if new.comment_text is distinct from old.comment_text then
      insert into admin_edit_log (business_id, actor, actor_id, action, field, old_value, new_value)
        values (new.business_id, coalesce(jwt_type, 'admin'), actor_id_val,
                'comment_edit', 'comment',
                left(old.comment_text, 200), left(new.comment_text, 200));
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    -- Cascade-delete safety: if the parent epc_business is being
    -- deleted concurrently, the FK check on admin_edit_log.business_id
    -- fails. The comment_delete audit row would cascade-delete anyway,
    -- so silently swallow the violation.
    begin
      insert into admin_edit_log (business_id, actor, actor_id, action, field, old_value)
        values (old.business_id, coalesce(jwt_type, 'admin'), actor_id_val,
                'comment_delete', 'comment', left(old.comment_text, 200));
    exception when foreign_key_violation then
      null;
    end;
    return old;
  end if;
  return null;
end;
$$ language plpgsql;
