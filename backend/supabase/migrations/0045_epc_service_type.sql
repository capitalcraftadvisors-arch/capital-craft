-- =========================================================
-- 0045 — EPC service_type (Loans / Insurance / Both).
--
-- Set by the admin on an APPROVED EPC (the new "Service" box on the EPC
-- View). Drives what the EPC sees after login:
--   insurance access = service_type in ('insurance','both')      [no lender needed]
--   loan access      = loan_app_unlocked AND service_type in ('loans','both')
--
-- BACKFILL: loan access now also depends on service_type. To avoid pulling
-- the loan dashboard out from under EPCs who already have it, every EPC that
-- is currently loan-unlocked is backfilled to 'loans'. New EPCs start null
-- (→ "Under review") until the admin picks a service. NULLs are never
-- overwritten, and the loan SERVER gate (0017) is left untouched — loan
-- still requires a lender "Approved" tick exactly as before; service_type
-- only governs which BUTTON the EPC sees.
--
-- Rollback:
--   alter table epc_business drop constraint if exists epc_business_service_type_check;
--   alter table epc_business drop column if exists service_type;
-- =========================================================

alter table epc_business
  add column if not exists service_type text;

alter table epc_business
  drop constraint if exists epc_business_service_type_check;
alter table epc_business
  add constraint epc_business_service_type_check
  check (service_type is null or service_type in ('loans', 'insurance', 'both'));

comment on column epc_business.service_type is
  'Admin-set service on an approved EPC. loans|insurance|both. Gates the EPC portal buttons (insurance needs no lender approval; loan still does).';

-- Preserve loan access for EPCs that already have it.
update epc_business
   set service_type = 'loans'
 where service_type is null
   and loan_app_unlocked = true;
