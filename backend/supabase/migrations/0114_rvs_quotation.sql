-- 0114 — RVS Technologies quotation builder.
--
-- Their solar proposal is their own PDF (bundled:rvs, kept in the private
-- bucket with the sample's values painted out); no quote number. A no-op where
-- that EPC doesn't exist (test DB) or already has a template.

insert into public.epc_quotation_templates (epc_business_id, name, storage_path)
select b.id, 'RVS Technologies', 'bundled:rvs'
from public.epc_business b
where b.id = 'f04ed6d5-99cd-47be-8948-ca51e78bdba0'
  and not exists (select 1 from public.epc_quotation_templates t where t.epc_business_id = b.id);
