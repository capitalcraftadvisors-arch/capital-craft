-- 0105: Deleting a loan application is the owner account's only.
--
-- owner_accounts (0096) is unreadable from the browser / user JWT, so the
-- delete-loan-app route asks this SECURITY DEFINER function whether the CALLER
-- is an owner account. It answers only for the caller — it never lists or
-- reveals other owner accounts.
--
-- Rollback: drop function is_owner_account();

create or replace function is_owner_account()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from owner_accounts
    where business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
  )
$$;
revoke execute on function is_owner_account() from public, anon;
grant execute on function is_owner_account() to authenticated;
