-- 0082 — "Message to EPC": per-profile admin ⇄ EPC message thread + attention.
--
-- A two-way thread between the Capital Craft team (admin) and the owning EPC,
-- on BOTH loan and insurance profiles. DISTINCT from the admin-only
-- loan_comments (which EPCs never see). Lifecycle: an admin message raises
-- "attention" on the profile → it surfaces on the EPC portal (sorted to top,
-- badge) → the EPC reads, replies, edits the profile, and resolves → the admin
-- sees "resolved" the next time they open it. Delivery is load-on-open (the
-- dashboard's existing query reads these columns / embeds the thread) — NO
-- polling, so egress stays flat. Additive: every column is nullable/defaulted.

-- ── Thread tables ────────────────────────────────────────────────────────────
create table if not exists public.loan_messages (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.epc_applications(id) on delete cascade,
  sender         text not null check (sender in ('admin','epc')),
  author_id      uuid,
  author_name    text,
  body           text,
  attachments    jsonb not null default '[]'::jsonb,   -- [{path,name,mime}]
  doc_tags       text[] not null default '{}',          -- which documents this issue is about (multi)
  edited_at      timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists idx_loan_messages_app
  on public.loan_messages(application_id, created_at);

create table if not exists public.insurance_messages (
  id                       uuid primary key default gen_random_uuid(),
  insurance_application_id uuid not null references public.insurance_applications(id) on delete cascade,
  sender                   text not null check (sender in ('admin','epc')),
  author_id                uuid,
  author_name              text,
  body                     text,
  attachments              jsonb not null default '[]'::jsonb,
  doc_tags                 text[] not null default '{}',
  edited_at                timestamptz,
  created_at               timestamptz not null default now()
);
create index if not exists idx_insurance_messages_app
  on public.insurance_messages(insurance_application_id, created_at);

-- ── Attention lifecycle on the parent profiles ──────────────────────────────
alter table public.epc_applications
  add column if not exists attention_status     text check (attention_status in ('open','resolved')),
  add column if not exists attention_raised_at   timestamptz,
  add column if not exists attention_resolved_at timestamptz,
  add column if not exists attention_resolved_by text,
  add column if not exists msg_epc_seen_at       timestamptz,   -- EPC last opened the thread
  add column if not exists msg_admin_seen_at     timestamptz,    -- admin last opened the thread
  add column if not exists epc_last_activity_at  timestamptz;    -- EPC last replied/resolved (admin notice)

alter table public.insurance_applications
  add column if not exists attention_status     text check (attention_status in ('open','resolved')),
  add column if not exists attention_raised_at   timestamptz,
  add column if not exists attention_resolved_at timestamptz,
  add column if not exists attention_resolved_by text,
  add column if not exists msg_epc_seen_at       timestamptz,
  add column if not exists msg_admin_seen_at     timestamptz,
  add column if not exists epc_last_activity_at  timestamptz;

create index if not exists idx_epc_applications_attention
  on public.epc_applications(attention_status) where attention_status = 'open';
create index if not exists idx_insurance_applications_attention
  on public.insurance_applications(attention_status) where attention_status = 'open';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- admin (business_type='admin') → full access on every thread.
-- epc → read + reply on threads for its OWN profiles; edit/delete only its own
-- messages. Ownership is proven by the parent row being visible to the caller
-- (RLS on the parent already scopes epc_applications/insurance_applications).
alter table public.loan_messages       enable row level security;
alter table public.insurance_messages  enable row level security;

-- LOAN --------------------------------------------------------------------------
drop policy if exists loan_messages_admin_all on public.loan_messages;
create policy loan_messages_admin_all on public.loan_messages
  for all to public
  using ((auth.jwt() ->> 'business_type') = 'admin')
  with check ((auth.jwt() ->> 'business_type') = 'admin');

drop policy if exists loan_messages_epc_select on public.loan_messages;
create policy loan_messages_epc_select on public.loan_messages
  for select to public
  using (exists (select 1 from public.epc_applications a
                 where a.id = application_id
                   and a.epc_business_id = (NULLIF(auth.jwt() ->> 'business_id',''))::uuid));

drop policy if exists loan_messages_epc_insert on public.loan_messages;
create policy loan_messages_epc_insert on public.loan_messages
  for insert to public
  with check (sender = 'epc'
              and author_id = (NULLIF(auth.jwt() ->> 'business_id',''))::uuid
              and exists (select 1 from public.epc_applications a
                          where a.id = application_id
                            and a.epc_business_id = (NULLIF(auth.jwt() ->> 'business_id',''))::uuid));

drop policy if exists loan_messages_epc_update on public.loan_messages;
create policy loan_messages_epc_update on public.loan_messages
  for update to public
  using (sender = 'epc' and author_id = (NULLIF(auth.jwt() ->> 'business_id',''))::uuid)
  with check (sender = 'epc' and author_id = (NULLIF(auth.jwt() ->> 'business_id',''))::uuid);

drop policy if exists loan_messages_epc_delete on public.loan_messages;
create policy loan_messages_epc_delete on public.loan_messages
  for delete to public
  using (sender = 'epc' and author_id = (NULLIF(auth.jwt() ->> 'business_id',''))::uuid);

-- INSURANCE ---------------------------------------------------------------------
drop policy if exists insurance_messages_admin_all on public.insurance_messages;
create policy insurance_messages_admin_all on public.insurance_messages
  for all to public
  using ((auth.jwt() ->> 'business_type') = 'admin')
  with check ((auth.jwt() ->> 'business_type') = 'admin');

drop policy if exists insurance_messages_epc_select on public.insurance_messages;
create policy insurance_messages_epc_select on public.insurance_messages
  for select to public
  using (exists (select 1 from public.insurance_applications a
                 where a.id = insurance_application_id
                   and a.epc_business_id = (NULLIF(auth.jwt() ->> 'business_id',''))::uuid));

drop policy if exists insurance_messages_epc_insert on public.insurance_messages;
create policy insurance_messages_epc_insert on public.insurance_messages
  for insert to public
  with check (sender = 'epc'
              and author_id = (NULLIF(auth.jwt() ->> 'business_id',''))::uuid
              and exists (select 1 from public.insurance_applications a
                          where a.id = insurance_application_id
                            and a.epc_business_id = (NULLIF(auth.jwt() ->> 'business_id',''))::uuid));

drop policy if exists insurance_messages_epc_update on public.insurance_messages;
create policy insurance_messages_epc_update on public.insurance_messages
  for update to public
  using (sender = 'epc' and author_id = (NULLIF(auth.jwt() ->> 'business_id',''))::uuid)
  with check (sender = 'epc' and author_id = (NULLIF(auth.jwt() ->> 'business_id',''))::uuid);

drop policy if exists insurance_messages_epc_delete on public.insurance_messages;
create policy insurance_messages_epc_delete on public.insurance_messages
  for delete to public
  using (sender = 'epc' and author_id = (NULLIF(auth.jwt() ->> 'business_id',''))::uuid);
