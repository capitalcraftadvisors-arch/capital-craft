-- 0122 — Custom quotation template as a service (11/11/2026).
--
-- The partner portal offers two quotation templates: the standard ("simple")
-- one for everyone, and a CUSTOM one in the EPC's own company format:
--   1. the EPC uploads its sample quotation (epc_documents 'custom_quote_sample');
--   2. Capital Craft builds the template (an epc_quotation_templates row, as for
--      Bijlee / Sarvatra Energy / RVS) and marks it ready (ready_at) — the EPC
--      sees "Your custom template is ready";
--   3. it is free for 3 months from ready_at; after that it is locked
--      ("contact your relationship manager") unless CC switches it on (unlocked).
-- ready_at / unlocked are CC's to set: epc_quotation_templates is admin-write,
-- EPC read-only (0088).

alter type public.epc_doc_category add value if not exists 'custom_quote_sample';

alter table public.epc_quotation_templates
  add column if not exists ready_at timestamptz,
  add column if not exists unlocked boolean not null default false;

comment on column public.epc_quotation_templates.ready_at is
  'When CC marked the custom template ready — 3 free months start here. NULL = still being made.';
comment on column public.epc_quotation_templates.unlocked is
  'CC switched the custom template on (paid) — it never locks while true.';

-- Templates already in use (Bijlee, Sarvatra Energy, RVS) get their 3 free
-- months from today, the day this goes live. (Sustera's customer builder never
-- locks — the app exempts it — but its WhatsApp sending also waits for On.)
update public.epc_quotation_templates set ready_at = now() where ready_at is null;

-- The sidebar's Pendings count also counts EPCs whose sample quotation waits
-- for a ready custom template. (category compared as text: the enum value
-- added above can't be used before this migration commits.)
create or replace function admin_pending_count() returns int
language sql stable as $$
  select (select count(*) from epc_applications
           where approval_review_status = 'pending' or disb1_review_status = 'pending' or disb2_review_status = 'pending')::int
       + (select count(*) from epc_business where admin_review_status = 'pending')::int
       + (select count(distinct d.business_id) from epc_documents d
           where d.category::text = 'custom_quote_sample'
             and not exists (select 1 from epc_quotation_templates t
                              where t.epc_business_id = d.business_id and t.ready_at is not null))::int;
$$;
revoke execute on function admin_pending_count() from public, anon;
grant execute on function admin_pending_count() to authenticated;
