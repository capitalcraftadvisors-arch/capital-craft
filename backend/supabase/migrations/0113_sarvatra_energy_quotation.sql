-- 0113 — Sarvatra Energy quotation builder.
--
-- Their offer letter is their own PDF (bundled:sarvatra-energy, kept in the
-- private bucket); the quote number SE2025-26 <n> auto-numbers from serial_next
-- (0097). Their sample was SE2025-26 1579. A no-op where that EPC doesn't exist
-- (test DB) or already has a template.

insert into public.epc_quotation_templates (epc_business_id, name, storage_path, serial_next)
select b.id, 'Sarvatra Energy', 'bundled:sarvatra-energy', 1580
from public.epc_business b
where b.id = '8b74ea26-1fc5-443c-a8a2-b2d60d7f3d5d'
  and not exists (select 1 from public.epc_quotation_templates t where t.epc_business_id = b.id);
