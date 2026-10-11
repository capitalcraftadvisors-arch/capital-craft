-- 0090: Team-wide loan-lead visibility.
--
-- Until now loan_leads were scoped by the Manish -> Malvika hierarchy
-- (loan_leads_admin_tier, migration 0071): an OPERATIONS_USER saw only leads
-- assigned to herself and a MANAGER only his subtree. So a lead assigned to
-- Manish was invisible to Malvika, even though the team works a single shared
-- lead desk (and the loan-applications list is already shared across them).
--
-- Every admin-tier user now sees and manages ALL loan leads. Auto-assignment
-- and routing (the insert triggers) are unchanged -- assigned_to_user_id is
-- still stamped for ownership/sorting; this only widens who may read and act.

drop policy if exists "loan_leads_admin_tier"   on loan_leads;
drop policy if exists "loan_leads_admin_scoped" on loan_leads;
drop policy if exists "loan_leads_admin_all"    on loan_leads;

create policy "loan_leads_admin_all" on loan_leads for all
  using      ((auth.jwt() ->> 'business_type') = 'admin')
  with check ((auth.jwt() ->> 'business_type') = 'admin');
