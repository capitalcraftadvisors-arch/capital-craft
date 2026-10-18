-- 0095 — Claude connector (MCP) for the main admin: read-only portal data.
--
-- The connector link carries an OPAQUE random key (never a login token). Only
-- its SHA-256 hash is stored here. The `auth` edge function exchanges a valid
-- key (not revoked, not expired) for a 5-minute JWT whose role is mcp_reader:
-- a database role with SELECT only on the tables the tools read — so the
-- connector can never write, whatever RLS would allow its owner. RLS still
-- applies (policies are for PUBLIC), so it sees exactly what its owner sees.
--
-- Keys are created / exchanged only by the edge function (service role). The
-- owner can list and revoke their own keys.

create table if not exists mcp_tokens (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references epc_business(id) on delete cascade,
  key_hash    text not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz
);
create index if not exists mcp_tokens_owner_idx on mcp_tokens (business_id);

alter table mcp_tokens enable row level security;
drop policy if exists mcp_tokens_own_read on mcp_tokens;
drop policy if exists mcp_tokens_own_revoke on mcp_tokens;
create policy mcp_tokens_own_read on mcp_tokens for select to authenticated
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid);
create policy mcp_tokens_own_revoke on mcp_tokens for update to authenticated
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid)
  with check (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid);
revoke insert, delete on mcp_tokens from anon, authenticated;

-- Read-only role for the connector's short-lived JWTs.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'mcp_reader') then
    create role mcp_reader nologin noinherit;
  end if;
end $$;
grant mcp_reader to authenticator;
grant usage on schema public to mcp_reader;
grant select on epc_applications, epc_business, insurance_applications, epc_lender_status, loan_leads, other_insurance to mcp_reader;
