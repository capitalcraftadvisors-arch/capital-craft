-- 0143 — Claude connector links for each Capital Craft team login (user, 27/11).
--
-- The owner makes a link for itself or for a team member (auth fn mcp_create
-- { for }); each link reads as that person's login (RLS), and the auth fn's
-- mcp_exchange now accepts any Capital Craft team login, re-checked on every use.
-- Here: the owner sees every link and can revoke any (team members' too);
-- everyone else still sees / revokes only their own (0095).
--
-- rollback: drop policy mcp_tokens_owner_read on mcp_tokens;
--           drop policy mcp_tokens_owner_revoke on mcp_tokens;

drop policy if exists mcp_tokens_owner_read on mcp_tokens;
drop policy if exists mcp_tokens_owner_revoke on mcp_tokens;
create policy mcp_tokens_owner_read on mcp_tokens for select to authenticated
  using ((select is_owner_account()));
create policy mcp_tokens_owner_revoke on mcp_tokens for update to authenticated
  using ((select is_owner_account()))
  with check ((select is_owner_account()));
