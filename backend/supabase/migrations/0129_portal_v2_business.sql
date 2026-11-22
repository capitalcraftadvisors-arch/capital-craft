-- 0129 — Partner Portal v2: payments, the document vault, invoices, proposal
-- links, subscriptions with an end date, and a project for every loan (23/11/2026).
-- Additive: new tables + functions, new columns only on 0117 / 0128 tables;
-- loans, insurance and quotations keep every rule they have.
--
--   epc_project_payments   money received for a project (customer or lender)
--   epc_project_documents  any other file of a project (the vault also shows its
--                          photos and its loan's documents)
--   epc_invoices           GST invoices — paid feature, only after Installation done,
--                          numbered per EPC per financial year, cancel + re-issue only
--   epc_proposals          a public link to a quotation; the customer accepts there
--                          → the quotation is Accepted and a project starts
--   epc_projects_from_loans(business) — one project per filed loan (Loan in process)
--
-- Money (payments, invoices) follows epc_project_finance (0128): Site staff never read it.

-- ── Organization settings: invoice series, UPI ID, WhatsApp number ──────────────
alter table public.epc_org_profile
  add column if not exists invoice_prefix  text not null default 'INV/',
  add column if not exists upi_id          text,
  add column if not exists whatsapp_number text;

-- ── Subscriptions: invoices + an end date (null = no end) ──────────────────────
alter table public.epc_subscriptions
  add column if not exists invoices    boolean not null default false,
  add column if not exists valid_until date;

-- Has this EPC the paid feature today ('whatsapp' | 'invoices')? Used by the
-- server on every invoice / WhatsApp action.
create or replace function epc_has_feature(p_business uuid, p_feature text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select (case p_feature when 'whatsapp' then s.whatsapp when 'invoices' then s.invoices else false end)
           and (s.valid_until is null or s.valid_until >= (now() at time zone 'Asia/Kolkata')::date)
      from epc_subscriptions s where s.business_id = p_business), false)
$$;
revoke all on function epc_has_feature(uuid, text) from public;
grant execute on function epc_has_feature(uuid, text) to authenticated;

-- ── Payments ──────────────────────────────────────────────────────────────────
create table if not exists public.epc_project_payments (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.epc_business(id) on delete cascade,
  project_id        uuid not null references public.epc_projects(id) on delete cascade,
  paid_on           date not null default (now() at time zone 'Asia/Kolkata')::date,
  amount            numeric(14,2) not null check (amount > 0),
  source            text not null default 'customer' check (source in ('customer', 'lender')),
  mode              text check (mode in ('cash', 'upi', 'bank', 'cheque', 'card', 'other')),
  reference         text,
  notes             text,
  created_by_member uuid references public.epc_members(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists epc_project_payments_project_idx on public.epc_project_payments (project_id, paid_on);
create index if not exists epc_project_payments_business_idx on public.epc_project_payments (business_id, paid_on desc);
drop trigger if exists trg_stamp_epc_member on public.epc_project_payments;
create trigger trg_stamp_epc_member before insert on public.epc_project_payments for each row execute function stamp_epc_member();

alter table public.epc_project_payments enable row level security;
drop policy if exists epc_project_payments_read on public.epc_project_payments;
create policy epc_project_payments_read on public.epc_project_payments for select to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
         and (select epc_member_role()) in ('OWNER', 'ADMIN', 'VIEWER', 'SALES')
         and project_id in (select id from public.epc_projects));
drop policy if exists epc_project_payments_write on public.epc_project_payments;
create policy epc_project_payments_write on public.epc_project_payments for all to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
         and (select epc_member_role()) in ('OWNER', 'ADMIN', 'SALES')
         and project_id in (select id from public.epc_projects))
  with check (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
              and (select epc_member_role()) in ('OWNER', 'ADMIN', 'SALES')
              and project_id in (select id from public.epc_projects));
drop policy if exists epc_project_payments_admin_read on public.epc_project_payments;
create policy epc_project_payments_admin_read on public.epc_project_payments for select to public
  using ((auth.jwt() ->> 'business_type') = 'admin');

-- ── Project documents ─────────────────────────────────────────────────────────
create table if not exists public.epc_project_documents (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.epc_business(id) on delete cascade,
  project_id        uuid not null references public.epc_projects(id) on delete cascade,
  category          text not null default 'other',
  storage_path      text not null,
  file_name         text,
  mime_type         text,
  original_size_bytes bigint,
  stored_size_bytes bigint,
  metadata          jsonb,
  created_by_member uuid references public.epc_members(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists epc_project_documents_project_idx on public.epc_project_documents (project_id, created_at);
drop trigger if exists trg_stamp_epc_member on public.epc_project_documents;
create trigger trg_stamp_epc_member before insert on public.epc_project_documents for each row execute function stamp_epc_member();

alter table public.epc_project_documents enable row level security;
-- Everyone who sees the project sees its files (Site staff: their projects, but no invoice copies).
drop policy if exists epc_project_documents_read on public.epc_project_documents;
create policy epc_project_documents_read on public.epc_project_documents for select to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and project_id in (select id from public.epc_projects)
         and (category <> 'invoice_copy' or (select epc_member_role()) <> 'SITE'));
drop policy if exists epc_project_documents_insert on public.epc_project_documents;
create policy epc_project_documents_insert on public.epc_project_documents for insert to public
  with check (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
              and (select epc_member_role()) in ('OWNER', 'ADMIN', 'SALES', 'SITE')
              and project_id in (select id from public.epc_projects));
drop policy if exists epc_project_documents_delete on public.epc_project_documents;
create policy epc_project_documents_delete on public.epc_project_documents for delete to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
         and project_id in (select id from public.epc_projects)
         and ((select epc_member_role()) in ('OWNER', 'ADMIN') or created_by_member = (select epc_member_id())));
drop policy if exists epc_project_documents_admin_read on public.epc_project_documents;
create policy epc_project_documents_admin_read on public.epc_project_documents for select to public
  using ((auth.jwt() ->> 'business_type') = 'admin');

-- ── Invoices ──────────────────────────────────────────────────────────────────
-- The running number per EPC per financial year (April–March), taken atomically.
create table if not exists public.epc_invoice_series (
  business_id uuid not null references public.epc_business(id) on delete cascade,
  fy          text not null,                 -- '2026-27'
  next_no     integer not null default 1,
  primary key (business_id, fy)
);
alter table public.epc_invoice_series enable row level security; -- no policies: the number trigger only

create table if not exists public.epc_invoices (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.epc_business(id) on delete cascade,
  project_id        uuid not null references public.epc_projects(id) on delete restrict,
  invoice_no        text not null default '',
  fy                text not null default '',
  invoice_date      date not null default (now() at time zone 'Asia/Kolkata')::date,
  customer_name     text not null,
  customer_address  text,
  customer_gstin    text,
  customer_state    text,
  place_of_supply   text,
  lines             jsonb not null default '[]'::jsonb, -- [{description, hsn, taxable, rate, cgst, sgst, igst, amount}]
  taxable           numeric(14,2) not null default 0,
  cgst              numeric(14,2) not null default 0,
  sgst              numeric(14,2) not null default 0,
  igst              numeric(14,2) not null default 0,
  total             numeric(14,2) not null default 0,
  status            text not null default 'issued' check (status in ('issued', 'cancelled')),
  cancelled_at      timestamptz,
  cancel_reason     text,
  replaces_id       uuid references public.epc_invoices(id) on delete set null,
  created_by_member uuid references public.epc_members(id) on delete set null,
  created_at        timestamptz not null default now()
);
create unique index if not exists epc_invoices_no on public.epc_invoices (business_id, invoice_no);
create index if not exists epc_invoices_project_idx on public.epc_invoices (project_id);
drop trigger if exists trg_stamp_epc_member on public.epc_invoices;
create trigger trg_stamp_epc_member before insert on public.epc_invoices for each row execute function stamp_epc_member();

-- A new invoice: the EPC has Invoices (subscription), the project is installed,
-- a re-issue replaces a cancelled invoice of the same project; then the number.
create or replace function epc_invoices_issue() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ord text[] := array['quote_won', 'site_survey', 'loan_in_process', 'material_dispatched',
                      'installation_done', 'net_metering_applied', 'commissioned', 'closed'];
  v_stage text;
  v_prefix text;
  v_n integer;
  y integer := extract(year from new.invoice_date)::int;
begin
  if not epc_has_feature(new.business_id, 'invoices') then raise exception 'invoices_locked'; end if;
  select stage into v_stage from epc_projects where id = new.project_id and business_id = new.business_id;
  if v_stage is null or array_position(ord, v_stage) < array_position(ord, 'installation_done') then
    raise exception 'install_first';
  end if;
  if new.replaces_id is not null and not exists (
       select 1 from epc_invoices i where i.id = new.replaces_id and i.project_id = new.project_id and i.status = 'cancelled') then
    raise exception 'replace_cancelled_only';
  end if;
  new.status := 'issued'; new.cancelled_at := null; new.cancel_reason := null;
  if extract(month from new.invoice_date) < 4 then y := y - 1; end if;
  new.fy := y || '-' || lpad(((y + 1) % 100)::text, 2, '0');
  insert into epc_org_profile (business_id) values (new.business_id) on conflict (business_id) do nothing;
  select invoice_prefix into v_prefix from epc_org_profile where business_id = new.business_id;
  insert into epc_invoice_series (business_id, fy, next_no) values (new.business_id, new.fy, 2)
    on conflict (business_id, fy) do update set next_no = epc_invoice_series.next_no + 1
    returning next_no - 1 into v_n;
  new.invoice_no := coalesce(v_prefix, '') || new.fy || '/' || lpad(v_n::text, 3, '0');
  return new;
end $$;
drop trigger if exists trg_epc_invoices_issue on public.epc_invoices;
create trigger trg_epc_invoices_issue before insert on public.epc_invoices for each row execute function epc_invoices_issue();

-- An issued invoice never changes — it can only be cancelled (with a reason).
create or replace function epc_invoices_final() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status = 'issued' and new.status = 'cancelled' and coalesce(btrim(new.cancel_reason), '') <> ''
     and (to_jsonb(new) - array['status', 'cancelled_at', 'cancel_reason']) = (to_jsonb(old) - array['status', 'cancelled_at', 'cancel_reason']) then
    new.cancelled_at := now();
    return new;
  end if;
  raise exception 'invoice_final';
end $$;
drop trigger if exists trg_epc_invoices_final on public.epc_invoices;
create trigger trg_epc_invoices_final before update on public.epc_invoices for each row execute function epc_invoices_final();

alter table public.epc_invoices enable row level security;
drop policy if exists epc_invoices_read on public.epc_invoices;
create policy epc_invoices_read on public.epc_invoices for select to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
         and (select epc_member_role()) in ('OWNER', 'ADMIN', 'VIEWER', 'SALES')
         and project_id in (select id from public.epc_projects));
drop policy if exists epc_invoices_insert on public.epc_invoices;
create policy epc_invoices_insert on public.epc_invoices for insert to public
  with check (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
              and (select epc_member_role()) in ('OWNER', 'ADMIN', 'SALES')
              and project_id in (select id from public.epc_projects));
drop policy if exists epc_invoices_cancel on public.epc_invoices;
create policy epc_invoices_cancel on public.epc_invoices for update to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_member_role()) in ('OWNER', 'ADMIN'))
  with check (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid);
drop policy if exists epc_invoices_admin_read on public.epc_invoices;
create policy epc_invoices_admin_read on public.epc_invoices for select to public
  using ((auth.jwt() ->> 'business_type') = 'admin');
-- no delete policy: an invoice is never deleted

-- ── Proposal links ────────────────────────────────────────────────────────────
create table if not exists public.epc_proposals (
  token         text primary key default replace(gen_random_uuid()::text, '-', ''),
  business_id   uuid not null references public.epc_business(id) on delete cascade,
  quote_id      uuid not null references public.epc_quotes(id) on delete cascade,
  snapshot      jsonb not null,   -- what the customer sees: {customer_name, mobile, city, kw, total, net, quote_no, quote_date, valid_till, org: {name, phone, email}, lines: [...]}
  pdf_path      text,             -- the quotation PDF in the private bucket (opened through a signed portal link)
  created_by_member uuid references public.epc_members(id) on delete set null,
  created_at    timestamptz not null default now(),
  viewed_at     timestamptz,
  accepted_at   timestamptz,
  accepted_name text,
  project_id    uuid references public.epc_projects(id) on delete set null
);
create index if not exists epc_proposals_quote_idx on public.epc_proposals (quote_id, created_at desc);
drop trigger if exists trg_stamp_epc_member on public.epc_proposals;
create trigger trg_stamp_epc_member before insert on public.epc_proposals for each row execute function stamp_epc_member();

alter table public.epc_proposals enable row level security;
drop policy if exists epc_proposals_read on public.epc_proposals;
create policy epc_proposals_read on public.epc_proposals for select to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and quote_id in (select id from public.epc_quotes));
drop policy if exists epc_proposals_insert on public.epc_proposals;
create policy epc_proposals_insert on public.epc_proposals for insert to public
  with check (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
              and (select epc_member_role()) in ('OWNER', 'ADMIN', 'SALES')
              and quote_id in (select id from public.epc_quotes));
drop policy if exists epc_proposals_admin_read on public.epc_proposals;
create policy epc_proposals_admin_read on public.epc_proposals for select to public
  using ((auth.jwt() ->> 'business_type') = 'admin');

-- The customer's page (no login): what the proposal shows. Marks it seen.
create or replace function epc_proposal_get(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p epc_proposals%rowtype;
begin
  select * into p from epc_proposals where token = p_token;
  if not found then return null; end if;
  if p.viewed_at is null then update epc_proposals set viewed_at = now() where token = p_token; end if;
  return jsonb_build_object('snapshot', p.snapshot, 'pdf_path', p.pdf_path,
                            'accepted_at', p.accepted_at, 'accepted_name', p.accepted_name);
end $$;

-- The customer accepts: the quotation becomes Accepted and a project starts (once).
create or replace function epc_proposal_accept(p_token text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p epc_proposals%rowtype;
  s jsonb;
  v_project uuid;
begin
  select * into p from epc_proposals where token = p_token for update;
  if not found then raise exception 'not_found'; end if;
  if p.accepted_at is not null then
    return jsonb_build_object('accepted_at', p.accepted_at, 'accepted_name', p.accepted_name);
  end if;
  if nullif(p.snapshot ->> 'valid_till', '') is not null
     and (p.snapshot ->> 'valid_till')::date < (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'expired';
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'name_required'; end if;
  s := p.snapshot;
  insert into epc_projects (business_id, customer_name, mobile, city, kw, payment_mode, stage)
  values (p.business_id, coalesce(nullif(s ->> 'customer_name', ''), btrim(p_name)), nullif(s ->> 'mobile', ''),
          nullif(s ->> 'city', ''), nullif(s ->> 'kw', '')::numeric, 'cash', 'quote_won')
  returning id into v_project;
  insert into epc_project_finance (project_id, business_id, project_cost)
  values (v_project, p.business_id, nullif(s ->> 'total', '')::numeric);
  update epc_quotes set status = 'accepted', updated_at = now() where id = p.quote_id;
  update epc_proposals set accepted_at = now(), accepted_name = btrim(p_name), project_id = v_project where token = p_token;
  return jsonb_build_object('accepted_at', now(), 'accepted_name', btrim(p_name));
end $$;

revoke all on function epc_proposal_get(text) from public;
revoke all on function epc_proposal_accept(text, text) from public;
grant execute on function epc_proposal_get(text) to anon, authenticated;
grant execute on function epc_proposal_accept(text, text) to anon, authenticated;

-- ── A project for every filed loan ────────────────────────────────────────────
-- One project per submitted, not rejected loan of the company that has none yet
-- (stage Loan in process, payment Loan, the loan's project cost). Returns how many.
create or replace function epc_projects_from_loans(p_business uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer := 0;
  a record;
  v_project uuid;
begin
  if not (nullif(auth.jwt() ->> 'business_type', '') = 'admin'
          or p_business = nullif(auth.jwt() ->> 'business_id', '')::uuid
          or auth.jwt() is null) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  for a in
    select x.* from epc_applications x
     where x.epc_business_id = p_business and x.submitted_at is not null and x.status <> 'rejected'
       and not exists (select 1 from epc_projects p where p.application_id = x.id)
  loop
    insert into epc_projects (business_id, application_id, customer_name, mobile, city, kw, payment_mode, stage, created_by_member)
    values (p_business, a.id, coalesce(nullif(a.borrower_name, ''), nullif(a.aadhaar_name, ''), 'Customer'), a.borrower_mobile, a.install_city,
            case when lower(coalesce(a.project_size_unit, 'kw')) = 'mw' then a.project_size * 1000 else a.project_size end,
            'loan', 'loan_in_process', a.created_by_member)
    returning id into v_project;
    insert into epc_project_finance (project_id, business_id, project_cost) values (v_project, p_business, a.total_project_cost);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function epc_projects_from_loans(uuid) from public;
grant execute on function epc_projects_from_loans(uuid) to authenticated;

-- The demo EPC (Partner Portal v2 goes there first) gets its projects now.
do $$
declare b record;
begin
  for b in select id from public.epc_business where is_demo loop
    perform epc_projects_from_loans(b.id);
  end loop;
end $$;
