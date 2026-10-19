-- 0097 — Bijlee Solar quotation builder.
--
-- Bijlee's quotation is their own PDF shipped with the app (bundled:bijlee).
-- Its serial number (BIJ-<n>/P/1.2) is auto-numbered per EPC: serial_next is
-- the number the builder suggests next.

alter table public.epc_quotation_templates add column if not exists serial_next int;

-- After a quotation is generated with serial number p_used, the next suggested
-- number moves past it. Only the template's own EPC (or an admin) can move it.
create or replace function quotation_serial_used(p_template uuid, p_used int)
returns int
language plpgsql security definer set search_path = public as $$
declare v_next int;
begin
  update epc_quotation_templates
     set serial_next = greatest(coalesce(serial_next, 1), p_used + 1), updated_at = now()
   where id = p_template
     and (epc_business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
          or nullif(auth.jwt() ->> 'business_type', '') = 'admin')
  returning serial_next into v_next;
  return v_next;
end $$;
revoke execute on function quotation_serial_used(uuid, int) from public, anon;
grant execute on function quotation_serial_used(uuid, int) to authenticated;

-- Bijlee Solar's template; their last quotation was BIJ-323. A no-op where that
-- EPC doesn't exist (e.g. the test database).
insert into public.epc_quotation_templates (epc_business_id, name, storage_path, serial_next)
select b.id, 'Bijlee Solar', 'bundled:bijlee', 324
from public.epc_business b
where b.id = '6c0c7451-d51a-4620-9b6c-1519f08883dc'
  and not exists (select 1 from public.epc_quotation_templates t where t.epc_business_id = b.id);
