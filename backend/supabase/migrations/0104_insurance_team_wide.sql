-- 0104: Team-wide solar-insurance visibility.
--
-- Until now insurance_applications were scoped by the hierarchy
-- (admin_tier_insurance, migration 0071): an OPERATIONS_USER saw only files
-- assigned to herself and a MANAGER only his subtree. New insurance auto-assigns
-- to the main admin, so Malvika and Manish never saw incoming insurance files.
--
-- Every admin-tier user now sees and manages ALL insurance files — new and
-- existing (same as loan leads, 0090). Auto-assignment (the insert trigger) is
-- unchanged; the EPC's own policy (own_insurance) and the demo-tenant hide
-- (hide_demo_insurance, RESTRICTIVE) are untouched. Other Insurance (0093)
-- stays main-admin only.
--
-- Rollback: recreate 0071's "admin_tier_insurance" verbatim and drop
-- "admin_all_insurance".

drop policy if exists "admin_tier_insurance"   on insurance_applications;
drop policy if exists "admin_scoped_insurance" on insurance_applications;
drop policy if exists "admin_all_insurance"    on insurance_applications;

create policy "admin_all_insurance" on insurance_applications for all
  using      ((auth.jwt() ->> 'business_type') = 'admin')
  with check ((auth.jwt() ->> 'business_type') = 'admin');
