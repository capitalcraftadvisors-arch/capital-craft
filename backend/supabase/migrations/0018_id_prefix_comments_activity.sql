-- =========================================================
-- 0018 — Admin portal: ID prefix + comments + activity log
--
-- (1) epc_display_id: prefix CC- → EPC-
--     Rewrites the format function; backfills all existing rows.
--     Sequence + mobile-last-5 stay identical — only the prefix flips.
--
-- (2) epc_comments: admin-only free-text notes on an EPC
--     Multiple comments per EPC. Admins can create/edit/delete.
--     Admin-only RLS; no EPC policy (invisible to EPCs).
--
-- (3) Activity log extensions
--     admin_edit_log.action is TEXT (no enum) — reuses it directly.
--     Adds:
--       - trigger on epc_lender_status to log approve / un-approve /
--         docs_given / docs_ungiven per lender (per-row change).
--       - trigger on epc_comments to log comment_add / _edit / _delete.
--     Existing app-level logAudit() writes (field_edit, doc_*, …) stay.
--
-- Rollback:
--   drop trigger if exists trg_epc_comment_log on epc_comments;
--   drop function if exists log_epc_comment_change();
--   drop trigger if exists trg_epc_lender_status_log on epc_lender_status;
--   drop function if exists log_lender_status_change();
--   drop table if exists epc_comments;
--   -- (ID prefix reversal — data change — not automated. Use a backup.)
-- =========================================================


-- ── (1) ID prefix CC- → EPC- ──────────────────────────────────
create or replace function epc_format_display_id(mobile text, seq bigint) returns text as $$
  select 'EPC-' || epc_display_last5(mobile) || '-' || lpad(seq::text, 5, '0');
$$ language sql immutable;

-- Backfill: replace only the "CC-" prefix, keep last5 + sequence intact.
update epc_business
   set epc_display_id = 'EPC-' || substring(epc_display_id from 4)
 where epc_display_id like 'CC-%';


-- ── (2) epc_comments table ─────────────────────────────────────
create table if not exists epc_comments (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references epc_business(id) on delete cascade,
  author_id    uuid,                 -- admin's business row id (nullable for legacy imports)
  author_name  text,                 -- snapshot of admin's contact_name at write time
  comment_text text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_epc_comments_business
  on epc_comments (business_id, created_at desc);

alter table epc_comments enable row level security;

-- ADMIN ONLY. No EPC policy at all → invisible to EPCs by RLS.
create policy "admin_all_epc_comments" on epc_comments for all
  using ((auth.jwt() ->> 'business_type') = 'admin');

drop trigger if exists trg_epc_comments_updated on epc_comments;
create trigger trg_epc_comments_updated
  before update on epc_comments
  for each row execute function set_updated_at();


-- ── (3a) Log approve / docs_given events into admin_edit_log ──
create or replace function log_lender_status_change() returns trigger as $$
declare
  jwt_bid  text := (auth.jwt() ->> 'business_id');
  jwt_type text := (auth.jwt() ->> 'business_type');
  actor_id_val uuid;
begin
  -- Silently skip when there's no user JWT (migrations, service-role,
  -- system calls). Better a missed audit row than a broken write.
  if jwt_bid is null then return coalesce(new, old); end if;
  begin
    actor_id_val := jwt_bid::uuid;
  exception when others then
    return coalesce(new, old);
  end;

  if tg_op = 'INSERT' then
    if new.approved then
      insert into admin_edit_log (business_id, actor, actor_id, action, field, new_value)
        values (new.business_id, coalesce(jwt_type, 'admin'), actor_id_val,
                'lender_approve', new.lender, 'true');
    end if;
    if new.docs_given then
      insert into admin_edit_log (business_id, actor, actor_id, action, field, new_value)
        values (new.business_id, coalesce(jwt_type, 'admin'), actor_id_val,
                'lender_docs_given', new.lender, 'true');
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if new.approved is distinct from old.approved then
      insert into admin_edit_log (business_id, actor, actor_id, action, field, old_value, new_value)
        values (new.business_id, coalesce(jwt_type, 'admin'), actor_id_val,
                case when new.approved then 'lender_approve' else 'lender_unapprove' end,
                new.lender, old.approved::text, new.approved::text);
    end if;
    if new.docs_given is distinct from old.docs_given then
      insert into admin_edit_log (business_id, actor, actor_id, action, field, old_value, new_value)
        values (new.business_id, coalesce(jwt_type, 'admin'), actor_id_val,
                case when new.docs_given then 'lender_docs_given' else 'lender_docs_ungiven' end,
                new.lender, old.docs_given::text, new.docs_given::text);
    end if;
    return new;
  end if;
  return coalesce(new, old);
end;
$$ language plpgsql;

drop trigger if exists trg_epc_lender_status_log on epc_lender_status;
create trigger trg_epc_lender_status_log
  after insert or update on epc_lender_status
  for each row execute function log_lender_status_change();


-- ── (3b) Log comment events into admin_edit_log ──────────────
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
    insert into admin_edit_log (business_id, actor, actor_id, action, field, old_value)
      values (old.business_id, coalesce(jwt_type, 'admin'), actor_id_val,
              'comment_delete', 'comment', left(old.comment_text, 200));
    return old;
  end if;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_epc_comment_log on epc_comments;
create trigger trg_epc_comment_log
  after insert or update or delete on epc_comments
  for each row execute function log_epc_comment_change();
