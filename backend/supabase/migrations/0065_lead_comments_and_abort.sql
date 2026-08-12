-- =========================================================
-- 0065 — lead_comments (admin-only, permanent) + loan_leads abort columns.
--
-- lead_comments mirrors loan_comments (0041) exactly, but keyed to
-- loan_leads instead of epc_applications, so a lead gets the SAME threaded,
-- admin-only, permanent Comments box the EPC profile and loan application
-- already have (CommentsSection reuses all three by branching on the key).
--
-- Admin-only by RLS (no EPC policy → invisible to EPCs) and permanent:
-- SELECT/INSERT/DELETE policies but NO UPDATE policy, so a posted comment can
-- never be silently rewritten.
--
-- loan_leads.aborted_at / abort_reason let an admin ABORT a lead: it stays in
-- the table for the record but drops off the active Lead dashboard (which now
-- filters aborted_at is null). Kept simple — no status-enum change (the
-- status check constraint stays draft/under_review/converted).
--
-- Rollback:
--   drop table if exists lead_comments;
--   alter table loan_leads drop column if exists aborted_at;
--   alter table loan_leads drop column if exists abort_reason;
-- =========================================================

create table if not exists lead_comments (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references loan_leads(id) on delete cascade,
  author_id    uuid,                 -- admin's business row id (nullable)
  author_name  text,                 -- snapshot of admin's contact_name at write time
  comment_text text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_lead_comments_lead
  on lead_comments (lead_id, created_at desc);

alter table lead_comments enable row level security;

-- ADMIN ONLY. No EPC policy at all → invisible to EPCs by RLS.
create policy "admin_select_lead_comments" on lead_comments for select
  using ((auth.jwt() ->> 'business_type') = 'admin');

create policy "admin_insert_lead_comments" on lead_comments for insert
  with check ((auth.jwt() ->> 'business_type') = 'admin');

create policy "admin_delete_lead_comments" on lead_comments for delete
  using ((auth.jwt() ->> 'business_type') = 'admin');

-- No UPDATE policy → all UPDATEs on lead_comments are denied (permanent).

-- ── Abort a lead ────────────────────────────────────────────────────────
alter table loan_leads add column if not exists aborted_at   timestamptz;
alter table loan_leads add column if not exists abort_reason text;
