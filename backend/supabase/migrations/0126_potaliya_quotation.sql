-- 0126 — Potaliya Enterprises quotation builder (their custom template request, 16/11).
--
-- Their solar proposal is their own PDF (bundled:potaliya, kept in the private
-- bucket); the proposal reference no. POT-<n>/P/1.1 auto-numbers from serial_next
-- (0097). Their sample was POT-760/P/1.1. ready_at stays empty: CC tries it and
-- marks it ready on the EPC profile (0122). A no-op where that EPC doesn't exist
-- (test DB) or already has a template.

insert into public.epc_quotation_templates (epc_business_id, name, storage_path, serial_next)
select b.id, 'Potaliya Enterprises', 'bundled:potaliya', 761
from public.epc_business b
where b.id = '26d65c3a-4055-4a50-a99d-7ab79ab1fce7'
  and not exists (select 1 from public.epc_quotation_templates t where t.epc_business_id = b.id);
