-- Allow admins to DELETE non-EPC customer leads from the console's Leads tab.
-- (0051 only granted admin select + update; deletes were blocked by RLS.)
--
-- rollback: drop policy if exists customer_leads_admin_delete on customer_leads;

drop policy if exists customer_leads_admin_delete on customer_leads;
create policy customer_leads_admin_delete on customer_leads
  for delete to authenticated
  using (auth.jwt() ->> 'business_type' = 'admin');
