-- 0120 — What each EPC staff login (0119) may see and do, enforced in the
-- database. Ships with 0119 (and the auth function that adds the member_id claim).
--
-- Who did what: created_by_member on loans, insurance, loan documents and
-- quotations; author_member_id on messages — stamped from the caller's token
-- by trigger (null = the owner, or a server / CC write).
--
-- Roles (epc_member_role(), read live):
--   OWNER / ADMIN  everything of the company (ADMIN: not the KYC row / documents)
--   SALES          only the loans / insurance / quotations it created (+ their
--                  documents, lenders and messages); can't delete loans / insurance
--   VIEWER         reads everything, changes nothing
--   a member's modules (loans / insurance / quotes) narrow it further;
--   a switched-off member gets nothing.
-- CC admins keep their own policies (unchanged).

-- ── Who did what ────────────────────────────────────────────────────────────
alter table public.epc_applications       add column if not exists created_by_member uuid references public.epc_members(id) on delete set null;
alter table public.insurance_applications add column if not exists created_by_member uuid references public.epc_members(id) on delete set null;
alter table public.user_application_docs  add column if not exists created_by_member uuid references public.epc_members(id) on delete set null;
alter table public.loan_messages          add column if not exists author_member_id  uuid references public.epc_members(id) on delete set null;
alter table public.insurance_messages     add column if not exists author_member_id  uuid references public.epc_members(id) on delete set null;
do $$ begin
  alter table public.epc_quotes add constraint epc_quotes_created_by_member_fk foreign key (created_by_member) references public.epc_members(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.epc_quotes add constraint epc_quotes_updated_by_member_fk foreign key (updated_by_member) references public.epc_members(id) on delete set null;
exception when duplicate_object then null; end $$;

-- An EPC caller's row is stamped with its member (null = the owner); server
-- (service role) and CC writes keep what they set.
create or replace function stamp_epc_member() returns trigger
language plpgsql set search_path = public as $$
declare
  epc boolean := auth.jwt() is not null and coalesce(auth.jwt() ->> 'business_type', '') <> 'admin';
begin
  if not epc then return new; end if;
  if tg_table_name in ('loan_messages', 'insurance_messages') then
    if tg_op = 'INSERT' then new.author_member_id := epc_member_id(); end if;
  elsif tg_op = 'INSERT' then
    new.created_by_member := epc_member_id();
  end if;
  if tg_table_name = 'epc_quotes' then new.updated_by_member := epc_member_id(); end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['epc_applications', 'insurance_applications', 'user_application_docs', 'loan_messages', 'insurance_messages'] loop
    execute format('drop trigger if exists trg_stamp_epc_member on public.%I', t);
    execute format('create trigger trg_stamp_epc_member before insert on public.%I for each row execute function stamp_epc_member()', t);
  end loop;
end $$;
drop trigger if exists trg_stamp_epc_member on public.epc_quotes;
create trigger trg_stamp_epc_member before insert or update on public.epc_quotes for each row execute function stamp_epc_member();

-- ── epc_business (the company / KYC row): everyone reads, only the owner writes ──
drop policy if exists "own_business" on public.epc_business;
drop policy if exists own_business_read on public.epc_business;
create policy own_business_read on public.epc_business for select to public
  using (id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_member_role()) is not null);
drop policy if exists own_business_write on public.epc_business;
create policy own_business_write on public.epc_business for all to public
  using (id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_member_role()) = 'OWNER')
  with check (id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_member_role()) = 'OWNER');

-- ── epc_documents (KYC documents) — same ───────────────────────────────────────
drop policy if exists "own_docs" on public.epc_documents;
drop policy if exists own_docs_read on public.epc_documents;
create policy own_docs_read on public.epc_documents for select to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and category <> 'gst_r3b' and (select epc_member_role()) is not null);
drop policy if exists own_docs_write on public.epc_documents;
create policy own_docs_write on public.epc_documents for all to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and category <> 'gst_r3b' and (select epc_member_role()) = 'OWNER')
  with check (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and category <> 'gst_r3b' and (select epc_member_role()) = 'OWNER');

-- ── Loans ───────────────────────────────────────────────────────────────────
drop policy if exists "own_applications" on public.epc_applications;
drop policy if exists own_applications_read on public.epc_applications;
create policy own_applications_read on public.epc_applications for select to public
  using (epc_business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_has_module('loans'))
         and ((select epc_member_role()) in ('OWNER', 'ADMIN', 'VIEWER') or ((select epc_member_role()) = 'SALES' and created_by_member = (select epc_member_id()))));
drop policy if exists own_applications_insert on public.epc_applications;
create policy own_applications_insert on public.epc_applications for insert to public
  with check (epc_business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_has_module('loans'))
              and (select epc_member_role()) in ('OWNER', 'ADMIN', 'SALES'));
drop policy if exists own_applications_update on public.epc_applications;
create policy own_applications_update on public.epc_applications for update to public
  using (epc_business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_has_module('loans'))
         and ((select epc_member_role()) in ('OWNER', 'ADMIN') or ((select epc_member_role()) = 'SALES' and created_by_member = (select epc_member_id()))))
  with check (epc_business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid);
drop policy if exists own_applications_delete on public.epc_applications;
create policy own_applications_delete on public.epc_applications for delete to public
  using (epc_business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_member_role()) in ('OWNER', 'ADMIN'));

-- Loan documents follow the loan (the subquery reads epc_applications under the rules above).
drop policy if exists "own_app_docs" on public.user_application_docs;
drop policy if exists own_app_docs_read on public.user_application_docs;
create policy own_app_docs_read on public.user_application_docs for select to public
  using (application_id in (select id from public.epc_applications where epc_business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid));
drop policy if exists own_app_docs_write on public.user_application_docs;
create policy own_app_docs_write on public.user_application_docs for all to public
  using ((select epc_member_role()) in ('OWNER', 'ADMIN', 'SALES')
         and application_id in (select id from public.epc_applications where epc_business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid))
  with check ((select epc_member_role()) in ('OWNER', 'ADMIN', 'SALES')
              and application_id in (select id from public.epc_applications where epc_business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid));

-- ── Insurance ───────────────────────────────────────────────────────────────
drop policy if exists "own_insurance" on public.insurance_applications;
drop policy if exists own_insurance_read on public.insurance_applications;
create policy own_insurance_read on public.insurance_applications for select to public
  using (epc_business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_has_module('insurance'))
         and ((select epc_member_role()) in ('OWNER', 'ADMIN', 'VIEWER') or ((select epc_member_role()) = 'SALES' and created_by_member = (select epc_member_id()))));
drop policy if exists own_insurance_insert on public.insurance_applications;
create policy own_insurance_insert on public.insurance_applications for insert to public
  with check (epc_business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_has_module('insurance'))
              and (select epc_member_role()) in ('OWNER', 'ADMIN', 'SALES'));
drop policy if exists own_insurance_update on public.insurance_applications;
create policy own_insurance_update on public.insurance_applications for update to public
  using (epc_business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_has_module('insurance'))
         and ((select epc_member_role()) in ('OWNER', 'ADMIN') or ((select epc_member_role()) = 'SALES' and created_by_member = (select epc_member_id()))))
  with check (epc_business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid);
drop policy if exists own_insurance_delete on public.insurance_applications;
create policy own_insurance_delete on public.insurance_applications for delete to public
  using (epc_business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_member_role()) in ('OWNER', 'ADMIN'));

-- ── Messages: reading follows the file; sending needs a role that can work;
--    a message is changed / removed only by the person who wrote it ─────────
drop policy if exists loan_messages_epc_insert on public.loan_messages;
create policy loan_messages_epc_insert on public.loan_messages for insert to public
  with check (sender = 'epc'
              and author_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
              and (select epc_member_role()) in ('OWNER', 'ADMIN', 'SALES')
              and exists (select 1 from public.epc_applications a
                           where a.id = application_id and a.epc_business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid));
drop policy if exists loan_messages_epc_update on public.loan_messages;
create policy loan_messages_epc_update on public.loan_messages for update to public
  using (sender = 'epc' and author_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
         and author_member_id is not distinct from (select epc_member_id()) and (select epc_member_role()) in ('OWNER', 'ADMIN', 'SALES'))
  with check (sender = 'epc' and author_id = nullif(auth.jwt() ->> 'business_id', '')::uuid);
drop policy if exists loan_messages_epc_delete on public.loan_messages;
create policy loan_messages_epc_delete on public.loan_messages for delete to public
  using (sender = 'epc' and author_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
         and author_member_id is not distinct from (select epc_member_id()) and (select epc_member_role()) in ('OWNER', 'ADMIN', 'SALES'));

drop policy if exists insurance_messages_epc_insert on public.insurance_messages;
create policy insurance_messages_epc_insert on public.insurance_messages for insert to public
  with check (sender = 'epc'
              and author_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
              and (select epc_member_role()) in ('OWNER', 'ADMIN', 'SALES')
              and exists (select 1 from public.insurance_applications a
                           where a.id = insurance_application_id and a.epc_business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid));
drop policy if exists insurance_messages_epc_update on public.insurance_messages;
create policy insurance_messages_epc_update on public.insurance_messages for update to public
  using (sender = 'epc' and author_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
         and author_member_id is not distinct from (select epc_member_id()) and (select epc_member_role()) in ('OWNER', 'ADMIN', 'SALES'))
  with check (sender = 'epc' and author_id = nullif(auth.jwt() ->> 'business_id', '')::uuid);
drop policy if exists insurance_messages_epc_delete on public.insurance_messages;
create policy insurance_messages_epc_delete on public.insurance_messages for delete to public
  using (sender = 'epc' and author_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
         and author_member_id is not distinct from (select epc_member_id()) and (select epc_member_role()) in ('OWNER', 'ADMIN', 'SALES'));

-- ── Organization settings: everyone reads; owner / admin change ────────────
drop policy if exists epc_org_profile_own on public.epc_org_profile;
drop policy if exists epc_org_profile_read on public.epc_org_profile;
create policy epc_org_profile_read on public.epc_org_profile for select to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_member_role()) is not null);
drop policy if exists epc_org_profile_write on public.epc_org_profile;
create policy epc_org_profile_write on public.epc_org_profile for all to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_member_role()) in ('OWNER', 'ADMIN'))
  with check (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_member_role()) in ('OWNER', 'ADMIN'));

-- ── Quotations ──────────────────────────────────────────────────────────────
drop policy if exists epc_quotes_own on public.epc_quotes;
drop policy if exists epc_quotes_read on public.epc_quotes;
create policy epc_quotes_read on public.epc_quotes for select to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_has_module('quotes'))
         and ((select epc_member_role()) in ('OWNER', 'ADMIN', 'VIEWER') or ((select epc_member_role()) = 'SALES' and created_by_member = (select epc_member_id()))));
drop policy if exists epc_quotes_insert on public.epc_quotes;
create policy epc_quotes_insert on public.epc_quotes for insert to public
  with check (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_has_module('quotes'))
              and (select epc_member_role()) in ('OWNER', 'ADMIN', 'SALES'));
drop policy if exists epc_quotes_update on public.epc_quotes;
create policy epc_quotes_update on public.epc_quotes for update to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid and (select epc_has_module('quotes'))
         and ((select epc_member_role()) in ('OWNER', 'ADMIN') or ((select epc_member_role()) = 'SALES' and created_by_member = (select epc_member_id()))))
  with check (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid);
drop policy if exists epc_quotes_delete on public.epc_quotes;
create policy epc_quotes_delete on public.epc_quotes for delete to public
  using (business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
         and ((select epc_member_role()) in ('OWNER', 'ADMIN')
              or ((select epc_member_role()) = 'SALES' and created_by_member = (select epc_member_id()) and status = 'draft')));
