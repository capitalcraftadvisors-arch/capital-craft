-- 0088 — Quotation Builder.
--
-- Per-EPC quotation TEMPLATE (their own .docx format, stored once) + persisted
-- CUSTOM brand options for the builder's searchable dropdowns. The EPC fills a
-- ~60-second form and downloads a quotation in their exact format.

-- One (or more) template file(s) per EPC. storage_path is either "bundled:<key>"
-- (a template shipped with the app, e.g. bundled:ges = GHANPRIYA) or a GCS object.
create table if not exists public.epc_quotation_templates (
  id              uuid primary key default gen_random_uuid(),
  epc_business_id uuid not null references public.epc_business(id) on delete cascade,
  name            text not null default 'Quotation',
  storage_path    text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_epc_quote_tpl_biz
  on public.epc_quotation_templates(epc_business_id);

alter table public.epc_quotation_templates enable row level security;
-- admin = all; EPC = read its own template.
drop policy if exists epc_quote_tpl_admin_all on public.epc_quotation_templates;
create policy epc_quote_tpl_admin_all on public.epc_quotation_templates
  for all to public
  using ((auth.jwt() ->> 'business_type') = 'admin')
  with check ((auth.jwt() ->> 'business_type') = 'admin');
drop policy if exists epc_quote_tpl_own_read on public.epc_quotation_templates;
create policy epc_quote_tpl_own_read on public.epc_quotation_templates
  for select to public
  using (epc_business_id = (NULLIF(auth.jwt() ->> 'business_id',''))::uuid);

-- Custom brand/option values added via the builder's dropdowns — GLOBAL (shared
-- across EPCs), so a custom brand typed once is available to everyone forever.
-- field = module_brand | inverter_brand | mount | acdb | dcdb | cable | battery.
create table if not exists public.quotation_brand_options (
  field      text not null,
  value      text not null,
  created_at timestamptz not null default now(),
  primary key (field, value)
);
alter table public.quotation_brand_options enable row level security;
-- any authenticated caller may read + add a custom option (never delete).
drop policy if exists quote_brand_read on public.quotation_brand_options;
create policy quote_brand_read on public.quotation_brand_options
  for select to public using (true);
drop policy if exists quote_brand_insert on public.quotation_brand_options;
create policy quote_brand_insert on public.quotation_brand_options
  for insert to public with check (true);
