-- 0112 — A loan application's insurance profile. The loan profile's
-- "Insurance" button makes the insurance profile from the loan's own data
-- (/api/admin/loan-app/[id]/insurance) and links it here, so each loan has
-- at most one and the button opens it afterwards. Deleting the insurance
-- profile just clears the link.

alter table epc_applications
  add column if not exists insurance_application_id uuid
    references insurance_applications(id) on delete set null;

create unique index if not exists epc_applications_insurance_application_id_key
  on epc_applications (insurance_application_id) where insurance_application_id is not null;
