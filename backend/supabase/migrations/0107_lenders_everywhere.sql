-- 0107 — One lender list for the whole portal.
--
-- The lenders registry (0055) is THE list every screen and route reads. This:
--   (1) keeps each lender's Stakeholders profile (partners, 0106) in step with
--       it — a new lender gets its profile, a rename on either side follows;
--   (2) lets a loan be approved / rejected by ANY registered lender (FK) in
--       place of the fixed three (0042's checks);
--   (3) makes loan_application_lenders.lender_key a registered lender (FK) —
--       custom lenders already used on loans are registered first.

-- ── (3a) register lenders already used on loans ───────────────────────────
insert into lenders (key, label)
select distinct on (lender_key) lender_key, lender_label
from loan_application_lenders
where lender_key not in (select key from lenders)
order by lender_key, created_at
on conflict (key) do nothing;

-- ── (1) partners ↔ lenders ───────────────────────────────────────────────
-- A lender partner added before this (no lender_key) is registered by its name.
with s as (
  select p.id, p.name,
         coalesce(nullif(trim(both '_' from regexp_replace(lower(p.name), '[^a-z0-9]+', '_', 'g')), ''), 'lender') as key
  from partners p
  where p.kind = 'lender' and p.lender_key is null
), reg as (
  insert into lenders (key, label) select key, name from s on conflict (key) do nothing
)
update partners p set lender_key = s.key
from s
where p.id = s.id and not exists (select 1 from partners q where q.lender_key = s.key);

-- Every registered lender has a profile.
insert into partners (kind, name, lender_key)
select 'lender', l.label, l.key from lenders l
on conflict (lender_key) do nothing;

-- Definer functions: the registry is any admin's, profiles the main admin's —
-- the other side is written whoever made the change.
create or replace function lender_to_partner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into partners (kind, name, lender_key) values ('lender', new.label, new.key)
    on conflict (lender_key) do nothing;
  elsif new.label is distinct from old.label then
    update partners set name = new.label, updated_at = now()
    where lender_key = new.key and name is distinct from new.label;
  end if;
  return new;
end $$;
drop trigger if exists trg_lender_partner on lenders;
create trigger trg_lender_partner after insert or update of label on lenders
  for each row execute function lender_to_partner();

create or replace function partner_to_lender()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'lender' and new.lender_key is not null and new.name is distinct from old.name then
    update lenders set label = new.name where key = new.lender_key and label is distinct from new.name;
  end if;
  return new;
end $$;
drop trigger if exists trg_partner_lender on partners;
create trigger trg_partner_lender after update of name on partners
  for each row execute function partner_to_lender();

-- ── (2) loan decisions: any registered lender ────────────────────────────
alter table epc_applications drop constraint if exists epc_applications_approved_lender_check;
alter table epc_applications drop constraint if exists epc_applications_rejected_lender_check;
alter table epc_applications drop constraint if exists epc_applications_approved_lender_fkey;
alter table epc_applications add constraint epc_applications_approved_lender_fkey
  foreign key (approved_lender) references lenders (key) on update cascade;
alter table epc_applications drop constraint if exists epc_applications_rejected_lender_fkey;
alter table epc_applications add constraint epc_applications_rejected_lender_fkey
  foreign key (rejected_lender) references lenders (key) on update cascade;

-- ── (3b) per-loan lender rows: a registered lender ───────────────────────
alter table loan_application_lenders drop constraint if exists loan_application_lenders_lender_fkey;
alter table loan_application_lenders add constraint loan_application_lenders_lender_fkey
  foreign key (lender_key) references lenders (key) on update cascade;
