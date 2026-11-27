-- 0144 — What the Capital Craft team asks Claude (user, 27/11): every tool call
-- Claude makes through a connector link, with the question that led to it, so
-- the owner can see the sales / operations team's doubts and improve the portal.
--
--   mcp_calls          one row per tool call: whose link, the question (Claude
--                      passes it word for word), the tool, its other inputs,
--                      ok / error. report_gap rows = what Claude couldn't answer.
--   mcp_log_call(...)  the only way in: called by the connector (/api/mcp) with
--                      the link's 5-minute mcp_reader pass; the person comes
--                      from that pass, never from the caller's input.
--   The owner reads it (Pri → Claude connector → Questions asked); nobody else.
--
-- rollback: drop function mcp_log_call(text, text, jsonb, boolean, text); drop table mcp_calls;

create table if not exists mcp_calls (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  business_id uuid not null references epc_business(id) on delete cascade,
  question    text,
  tool        text not null,
  args        jsonb,
  ok          boolean not null,
  error       text
);
create index if not exists mcp_calls_at_idx on mcp_calls (created_at desc);

alter table mcp_calls enable row level security;
revoke all on mcp_calls from anon, authenticated;
grant select on mcp_calls to authenticated;
drop policy if exists mcp_calls_owner_read on mcp_calls;
create policy mcp_calls_owner_read on mcp_calls for select to authenticated
  using ((select is_owner_account()));

create or replace function mcp_log_call(p_question text, p_tool text, p_args jsonb, p_ok boolean, p_error text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'mcp_reader' then
    raise exception 'connector_only' using errcode = '42501';
  end if;
  insert into mcp_calls (business_id, question, tool, args, ok, error)
  values ((auth.jwt() ->> 'business_id')::uuid, left(p_question, 2000), left(p_tool, 60), p_args, p_ok, left(p_error, 500));
end $$;
revoke execute on function mcp_log_call(text, text, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function mcp_log_call(text, text, jsonb, boolean, text) to mcp_reader;
