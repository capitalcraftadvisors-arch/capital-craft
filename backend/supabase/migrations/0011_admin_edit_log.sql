-- =========================================================
-- 0011 — admin_edit_log: audit table for admin + EPC self-edit writes.
--
-- One row per: field change, doc upload, doc replace, doc delete,
-- members-array save, references-array save, and the EPC's
-- self-edit submit summary.
--
-- Written from the application layer (admin → admin's JWT; EPC
-- self-edit → user JWT for per-field rows, then service-role-free
-- because RLS allows EPC inserts where actor='epc').
--
-- RLS:
--   admin_all_edit_log  — admins SELECT/INSERT/UPDATE/DELETE everything.
--   epc_insert_own_log  — EPCs can INSERT rows for their OWN business
--                          ONLY when actor='epc'. They cannot SELECT.
-- =========================================================

create table if not exists admin_edit_log (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references epc_business(id) on delete cascade,
  actor       text not null,           -- 'admin' or 'epc'
  actor_id    uuid not null,           -- actor's epc_business.id
  action      text not null,           -- field_edit | doc_upload | doc_replace | doc_delete | members_edited | references_edited | self_edit_submit
  field       text,                    -- column name or doc category
  old_value   text,
  new_value   text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_admin_edit_log_business
  on admin_edit_log (business_id, created_at desc);

alter table admin_edit_log enable row level security;

create policy "admin_all_edit_log" on admin_edit_log for all
  using ((auth.jwt() ->> 'business_type') = 'admin');

create policy "epc_insert_own_log" on admin_edit_log for insert
  with check (
    business_id = (auth.jwt() ->> 'business_id')::uuid
    and actor = 'epc'
  );
