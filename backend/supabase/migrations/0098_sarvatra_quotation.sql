-- 0098 — Sarvatra Energy (gozerobils) quotation builder.
--
-- Their quotation is their own PDF shipped with the app (bundled:sarvatra); the
-- quote number Quote_GZB_<MM>-<NNN> auto-numbers from serial_next (0097). Their
-- sample was Quote_GZB_10-028. A no-op where that EPC doesn't exist (test DB).

insert into public.epc_quotation_templates (epc_business_id, name, storage_path, serial_next)
select b.id, 'Sarvatra Energy', 'bundled:sarvatra', 29
from public.epc_business b
where b.id = '8b74ea26-1fc5-443c-a8a2-b2d60d7f3d5d'
  and not exists (select 1 from public.epc_quotation_templates t where t.epc_business_id = b.id);
