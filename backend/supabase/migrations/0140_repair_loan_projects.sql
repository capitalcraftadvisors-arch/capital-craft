-- 0140 — One-off repair of the projects made from loans BEFORE 0139 (25/11/2026).
-- Needs 0139. LIVE DATA CHANGE: apply only after the user has seen the rows (the
-- read-only list below) and said yes.
--
-- 0133 (Sarvatra Energy, 23/11) and 0129 (the demo EPC) made a project for every
-- filed loan with the old rules: aborted loans included, disbursed loans at Loan in
-- process, every project dated the day it was switched on. 0139 fixes the rules for
-- new projects; this brings the old ones in line — but ONLY projects nobody has
-- worked on since they were made (still at Loan in process with its one history
-- entry, no photos, notes, Site staff, payments, documents, invoices or proposal):
--   · the loan is aborted       → the project is deleted (its finance row goes with it)
--   · the lender paid tranche 1 → Material dispatched
--   · every one                 → dated by the loan's submit (created_at)
--
-- Read-only list first:
--   select b.trade_name, p.customer_name, a.loan_display_id, p.created_at::date as made,
--          a.submitted_at::date as submitted, a.aborted_at is not null as aborted,
--          a.first_disbursement_amount is not null as disbursed
--     from epc_projects p join epc_applications a on a.id = p.application_id
--     join epc_business b on b.id = p.business_id
--    where <the untouched conditions below> order by b.trade_name, p.created_at;
--
-- rollback: none (deleted rows are gone) — take the list above before applying.

create temporary table repair_projects as
select p.id, a.submitted_at, a.aborted_at is not null as aborted, a.first_disbursement_amount is not null as disbursed
  from epc_projects p
  join epc_applications a on a.id = p.application_id
 where p.lead_id is null
   and p.stage = 'loan_in_process'
   and jsonb_array_length(coalesce(p.history, '[]'::jsonb)) = 1
   and jsonb_array_length(coalesce(p.photos, '[]'::jsonb)) = 0
   and p.notes is null
   and p.site_member_id is null
   and not exists (select 1 from epc_project_payments x where x.project_id = p.id)
   and not exists (select 1 from epc_project_documents x where x.project_id = p.id)
   and not exists (select 1 from epc_invoices x where x.project_id = p.id)
   and not exists (select 1 from epc_proposals x where x.project_id = p.id);

delete from epc_projects p using repair_projects r where r.id = p.id and r.aborted;

update epc_projects p set stage = 'material_dispatched'
  from repair_projects r where r.id = p.id and not r.aborted and r.disbursed;

update epc_projects p set created_at = r.submitted_at
  from repair_projects r where r.id = p.id and not r.aborted and r.submitted_at is not null;

drop table repair_projects;
