-- 0115 — approval details + EPC passwords:
--   disbursement_advice  a new loan document (the lender's disbursement advice
--                        letter), uploaded with the sanction letter
--   credit_ntc           the customer is New To Credit (NTC) — may go with a score
--   verify_login_password (0103) + keeps a readable copy of an EPC's password on
--                        every right login, so a password set before 0110 (kept
--                        only as a hash) is recovered the next time they log in

alter type loan_doc_category add value if not exists 'disbursement_advice';

alter table epc_applications add column if not exists credit_ntc boolean not null default false;

create or replace function verify_login_password(p_business_id uuid, p_password text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  c login_credentials%rowtype;
begin
  select * into c from login_credentials where business_id = p_business_id for update;
  if not found then return 'none'; end if;
  if c.locked_until is not null and c.locked_until > now() then return 'locked'; end if;
  if p_password is null or p_password = '' then return 'required'; end if;
  if crypt(p_password, c.password_hash) = c.password_hash then
    update login_credentials
      set failed_count = 0, locked_until = null,
          password_copy = case when exists (select 1 from epc_business b where b.id = p_business_id and b.business_type is distinct from 'admin')
                               then p_password end
      where business_id = p_business_id;
    return case when c.must_change then 'change' else 'ok' end;
  end if;
  update login_credentials
    set failed_count = case when c.failed_count + 1 >= 5 then 0 else c.failed_count + 1 end,
        locked_until = case when c.failed_count + 1 >= 5 then now() + interval '15 minutes' else null end
    where business_id = p_business_id;
  return 'bad';
end $$;

revoke execute on function verify_login_password(uuid, text) from public, anon, authenticated;
grant execute on function verify_login_password(uuid, text) to service_role;
