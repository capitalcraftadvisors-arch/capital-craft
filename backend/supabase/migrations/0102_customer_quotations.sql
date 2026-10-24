-- 0102 — Customer applications (gozerobils builder, Sustera Ventures).
--
-- One row per customer quotation. `data` holds the form values (quotation +
-- PCR + agreement fields — one customer record, each form edits it); the PDFs
-- are generated from it on every download, never stored. pcr_at /
-- agreement_at = when that document was first made (its date on the PDF).
-- Only the EPC's own users see their rows — no admin access.

create table if not exists public.customer_quotations (
  id              uuid primary key default gen_random_uuid(),
  epc_business_id uuid not null default (nullif(auth.jwt() ->> 'business_id', ''))::uuid
                  references public.epc_business(id) on delete cascade,
  data            jsonb not null default '{}',
  pcr_at          timestamptz,
  agreement_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_customer_quotations_biz
  on public.customer_quotations(epc_business_id, created_at desc);

alter table public.customer_quotations enable row level security;
drop policy if exists customer_quotations_own_read on public.customer_quotations;
create policy customer_quotations_own_read on public.customer_quotations
  for select using (epc_business_id = (nullif(auth.jwt() ->> 'business_id', ''))::uuid);
drop policy if exists customer_quotations_own_insert on public.customer_quotations;
create policy customer_quotations_own_insert on public.customer_quotations
  for insert with check (epc_business_id = (nullif(auth.jwt() ->> 'business_id', ''))::uuid);
drop policy if exists customer_quotations_own_update on public.customer_quotations;
create policy customer_quotations_own_update on public.customer_quotations
  for update using (epc_business_id = (nullif(auth.jwt() ->> 'business_id', ''))::uuid)
  with check (epc_business_id = (nullif(auth.jwt() ->> 'business_id', ''))::uuid);

-- A new quotation moves the EPC's next suggested quote no. past the one used
-- (the running number at the end, e.g. Quote_GZB_10-029 → 30).
create or replace function customer_quotation_serial() returns trigger
language plpgsql security definer set search_path = public as $$
declare used text := substring(new.data ->> 'quote_no' from '(\d+)\D*$');
begin
  if used is not null and length(used) <= 6 then
    update epc_quotation_templates
       set serial_next = greatest(coalesce(serial_next, 1), used::int + 1), updated_at = now()
     where epc_business_id = new.epc_business_id;
  end if;
  return new;
end $$;
drop trigger if exists customer_quotation_serial on public.customer_quotations;
create trigger customer_quotation_serial after insert on public.customer_quotations
  for each row execute function customer_quotation_serial();
