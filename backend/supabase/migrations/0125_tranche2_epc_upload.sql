-- 0125 — 2nd-tranche documents from the EPC → the CC team is told (18/11/2026).
--
-- When an EPC uploads a 2nd-tranche (completion) document on its partner portal,
-- the loan row is stamped:
--   tranche2_epc_at  when the EPC last uploaded one of them
--   tranche2_docs    how many of the 5 completion documents are on file (anyone's)
-- The bell's red count and My Day's "2nd tranche received" list read these two
-- columns from the loan rows the portal ALREADY loads (My Day / Board, the Loans
-- list) — no request of their own, so no extra egress.
--
-- The 5 categories = COMPLETION_CATEGORIES (admin/src/components/CompletionDocsSection.tsx).
-- security definer: an EPC can't write these columns itself; only the trigger does.
-- The disbursement / review guards (0044, 0111, 0121) don't watch these columns.
--
-- rollback:
--   drop trigger if exists trg_tranche2_docs on user_application_docs;
--   drop function if exists stamp_tranche2_docs();
--   alter table epc_applications drop column if exists tranche2_epc_at, drop column if exists tranche2_docs;

alter table epc_applications
  add column if not exists tranche2_epc_at timestamptz,
  add column if not exists tranche2_docs   smallint;

create or replace function stamp_tranche2_docs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  app uuid;
  cat text;
  by_epc boolean := false;
begin
  if tg_op = 'DELETE' then
    app := old.application_id; cat := old.category::text;
  else
    app := new.application_id; cat := new.category::text;
    by_epc := coalesce(new.uploaded_by, '') = 'epc';
  end if;
  if cat not in ('completion_invoice', 'completion_panel_photo', 'completion_inverter_photo',
                 'completion_meter_photo', 'completion_report') then
    return null;
  end if;

  update epc_applications a
     set tranche2_docs = (
           select count(distinct d.category)
             from user_application_docs d
            where d.application_id = app
              and d.category::text in ('completion_invoice', 'completion_panel_photo', 'completion_inverter_photo',
                                       'completion_meter_photo', 'completion_report')),
         tranche2_epc_at = case when by_epc then now() else a.tranche2_epc_at end
   where a.id = app;
  return null;
end;
$$;

drop trigger if exists trg_tranche2_docs on user_application_docs;
create trigger trg_tranche2_docs
  after insert or delete on user_application_docs
  for each row execute function stamp_tranche2_docs();

-- Backfill from the documents already on file — without touching updated_at.
alter table epc_applications disable trigger trg_epc_applications_updated;

update epc_applications a
   set tranche2_docs   = d.docs,
       tranche2_epc_at = d.epc_at
  from (
    select application_id,
           count(distinct category)::smallint                    as docs,
           max(created_at) filter (where uploaded_by = 'epc')     as epc_at
      from user_application_docs
     where category::text in ('completion_invoice', 'completion_panel_photo', 'completion_inverter_photo',
                              'completion_meter_photo', 'completion_report')
     group by application_id
  ) d
 where d.application_id = a.id;

alter table epc_applications enable trigger trg_epc_applications_updated;
