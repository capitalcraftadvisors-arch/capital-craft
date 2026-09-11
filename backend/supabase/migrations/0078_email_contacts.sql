-- =========================================================
-- 0078 — Email address book (shared autocomplete)
--
-- Every address an admin sends to (TO / CC / BCC) is remembered here, so the
-- email composer can suggest it later ("priya" → priyankgupta123@gmail.com).
-- Shared across all admin users. Written by the send routes; read by the
-- composer. Additive and safe.
-- =========================================================

create table if not exists email_contacts (
  email        text primary key,
  name         text,
  used_count   integer not null default 1,
  last_used_at timestamptz not null default now()
);

alter table email_contacts enable row level security;

-- Admin-console users only (same gate as loan_comments).
create policy "admin_select_email_contacts" on email_contacts for select
  using ((auth.jwt() ->> 'business_type') = 'admin');
create policy "admin_insert_email_contacts" on email_contacts for insert
  with check ((auth.jwt() ->> 'business_type') = 'admin');
create policy "admin_update_email_contacts" on email_contacts for update
  using ((auth.jwt() ->> 'business_type') = 'admin')
  with check ((auth.jwt() ->> 'business_type') = 'admin');

create index if not exists email_contacts_recent_idx on email_contacts (last_used_at desc);
