-- 0118 — Saved quotations (partner portal "Quotations"): every quotation an EPC
-- makes with the standard builder, kept so it can be opened, changed, cloned,
-- downloaded again and moved Draft → Sent → Accepted / Declined.
--
--   payload   the whole editable quotation (customer, system, item rows,
--             pricing, payment, warranty, scope, terms, notes)
--   the list columns (number, status, customer, kW, dates, totals) are copied
--   out of it on save, so the list reads them without the payload.
--   quote_no  given on insert from the EPC's series (epc_org_profile.quote_prefix
--             + quote_next, 0117) in one statement, so two quotations can never
--             get the same number; skipped if already taken.
--   created_by_member / updated_by_member — the staff member (0119); null = the owner.

create table if not exists public.epc_quotes (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null default (nullif(auth.jwt() ->> 'business_id', ''))::uuid
                    references public.epc_business(id) on delete cascade,
  quote_no          text not null default '',
  status            text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined')),
  segment           text not null check (segment in ('residential', 'commercial')),
  customer_name     text not null default '',
  customer_mobile   text,
  kw                numeric(8, 2),
  quote_date        date not null default current_date,
  valid_till        date,
  total             numeric(14, 2) not null default 0,
  net               numeric(14, 2),
  payload           jsonb not null default '{}'::jsonb,
  created_by_member uuid,
  updated_by_member uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists epc_quotes_no on public.epc_quotes (business_id, quote_no);
create index if not exists epc_quotes_recent on public.epc_quotes (business_id, created_at desc);

-- The next number of the EPC's series, taken atomically (security definer: a
-- staff member who can't edit Settings still numbers its quotations).
create or replace function epc_quotes_number() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_prefix text;
  v_n integer;
begin
  if coalesce(new.quote_no, '') <> '' then return new; end if;
  insert into epc_org_profile (business_id) values (new.business_id) on conflict (business_id) do nothing;
  loop
    update epc_org_profile set quote_next = quote_next + 1
      where business_id = new.business_id
      returning quote_prefix, quote_next - 1 into v_prefix, v_n;
    new.quote_no := coalesce(v_prefix, '') || v_n;
    exit when not exists (select 1 from epc_quotes q where q.business_id = new.business_id and q.quote_no = new.quote_no);
  end loop;
  return new;
end $$;

drop trigger if exists trg_epc_quotes_number on public.epc_quotes;
create trigger trg_epc_quotes_number before insert on public.epc_quotes
  for each row execute function epc_quotes_number();

alter table public.epc_quotes enable row level security;

drop policy if exists epc_quotes_own on public.epc_quotes;
create policy epc_quotes_own on public.epc_quotes
  for all to public
  using (business_id = (nullif(auth.jwt() ->> 'business_id', ''))::uuid)
  with check (business_id = (nullif(auth.jwt() ->> 'business_id', ''))::uuid);

drop policy if exists epc_quotes_admin on public.epc_quotes;
create policy epc_quotes_admin on public.epc_quotes
  for all to public
  using ((auth.jwt() ->> 'business_type') = 'admin')
  with check ((auth.jwt() ->> 'business_type') = 'admin');
