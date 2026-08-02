-- =========================================================
-- 0056 — Loan status ladder + Tranche-1 doc categories (ENUM ADDITIONS ONLY)
--
-- Enum ADD VALUE is isolated in this file (no column/data statements use the
-- new values here) so they are committed before 0057 and any app code runs.
--
--   loan_status.'docs_sent'  — new "Docs Sent to lender" stage. 'on_hold'
--     already exists (0001) and is REUSED for Hold — not re-added.
--   loan_doc_category.'feasibility_report', 'mmr_advance_receipt' — the two
--     admin-uploaded Tranche-1 documents, stored as user_application_docs
--     rows exactly like the existing completion set.
--
-- Additive + non-destructive. No rollback for enum values (Postgres cannot
-- drop an enum value); harmless if unused.
-- =========================================================

alter type loan_status add value if not exists 'docs_sent';

alter type loan_doc_category add value if not exists 'feasibility_report';
alter type loan_doc_category add value if not exists 'mmr_advance_receipt';
