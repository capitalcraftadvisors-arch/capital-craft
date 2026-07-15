-- =========================================================
-- 0041 — loan_comments: admin-only comments on a loan application.
--
-- Mirrors epc_comments (0018) + its permanence policies (0039) exactly,
-- but keyed to epc_applications instead of epc_business.
--
-- WHY a separate table rather than reusing epc_comments:
--   epc_comments.business_id is NOT NULL -> epc_business. A loan application
--   belongs to an EPC, so reusing that table would either need a nullable
--   FK pair (messy) or would file loan notes against the EPC profile — the
--   two would leak into each other's Comments panel. Separate table keeps
--   them cleanly scoped.
--
-- Admin-only by RLS (no EPC policy at all -> invisible to EPCs), and
-- permanent: SELECT/INSERT/DELETE policies but NO UPDATE policy, so every
-- UPDATE is denied and a posted comment can never be silently rewritten.
--
-- Rollback:
--   drop table if exists loan_comments;
-- =========================================================

create table if not exists loan_comments (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references epc_applications(id) on delete cascade,
  author_id      uuid,                 -- admin's business row id (nullable)
  author_name    text,                 -- snapshot of admin's contact_name at write time
  comment_text   text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_loan_comments_application
  on loan_comments (application_id, created_at desc);

alter table loan_comments enable row level security;

-- ADMIN ONLY. No EPC policy at all → invisible to EPCs by RLS.
create policy "admin_select_loan_comments" on loan_comments for select
  using ((auth.jwt() ->> 'business_type') = 'admin');

create policy "admin_insert_loan_comments" on loan_comments for insert
  with check ((auth.jwt() ->> 'business_type') = 'admin');

create policy "admin_delete_loan_comments" on loan_comments for delete
  using ((auth.jwt() ->> 'business_type') = 'admin');

-- No UPDATE policy → all UPDATEs on loan_comments are denied (permanent).
