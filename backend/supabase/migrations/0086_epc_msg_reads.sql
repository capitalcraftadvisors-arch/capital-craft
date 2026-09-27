-- 0086 — Per-admin read state for "Message to EPC" updates.
--
-- Each Capital Craft admin (Manish, Malvika, the main admin — distinct
-- epc_business rows of business_type='admin') tracks WHICH profiles' EPC
-- replies they have seen, independently. So when Manish opens a profile's
-- message window the red count clears on HIS console only; Malvika still sees it
-- until she opens it too. (The old single msg_admin_seen_at was shared across
-- all admins — kept for back-compat, but the UI now reads per-admin from here.)
--
-- Keyed by (admin_id, kind, parent_id). admin_id = the admin's epc_business id
-- (the JWT business_id). Row upserted with seen_at=now when that admin opens the
-- profile's message window (POST /api/messages { action:"seen" }).
create table if not exists public.epc_msg_reads (
  admin_id  uuid not null,
  kind      text not null check (kind in ('loan','insurance')),
  parent_id uuid not null,
  seen_at   timestamptz not null default now(),
  primary key (admin_id, kind, parent_id)
);

alter table public.epc_msg_reads enable row level security;

-- Admins only, and only their OWN read rows.
drop policy if exists epc_msg_reads_admin_own on public.epc_msg_reads;
create policy epc_msg_reads_admin_own on public.epc_msg_reads
  for all to public
  using ((auth.jwt() ->> 'business_type') = 'admin'
         and admin_id = (NULLIF(auth.jwt() ->> 'business_id',''))::uuid)
  with check ((auth.jwt() ->> 'business_type') = 'admin'
              and admin_id = (NULLIF(auth.jwt() ->> 'business_id',''))::uuid);
