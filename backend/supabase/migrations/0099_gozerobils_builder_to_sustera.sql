-- 0099 — The gozerobils quotation builder (bundled:sarvatra: quotation + PCR +
-- agreement) belongs to SUSTERA VENTURES only, not SARVATRA ENERGY (0098 seeded
-- it there). Moves the template row and its quote counter. A no-op where those
-- EPCs don't exist (test DB) or once moved. Applied on PROD 2026-10-21.

update public.epc_quotation_templates t
   set epc_business_id = '42ef6067-dcc6-4000-bc1c-58957ac965ec',
       name = 'Sustera Ventures (gozerobils)',
       updated_at = now()
 where t.storage_path = 'bundled:sarvatra'
   and t.epc_business_id = '8b74ea26-1fc5-443c-a8a2-b2d60d7f3d5d'
   and exists (select 1 from public.epc_business b where b.id = '42ef6067-dcc6-4000-bc1c-58957ac965ec')
   and not exists (select 1 from public.epc_quotation_templates x where x.epc_business_id = '42ef6067-dcc6-4000-bc1c-58957ac965ec');
