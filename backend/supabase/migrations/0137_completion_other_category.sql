-- 0137 — 2nd-tranche "Additional documents" get their own type (25/11/2026).
--
-- Until now the extras uploaded in the 2nd-tranche section were saved as 'other',
-- the same pile as the loan application's other documents, so the 2nd-tranche
-- email to the lender couldn't tell them apart. From now on they are
-- 'completion_other'. Extras uploaded before this stay 'other' (the user, 25/11).
--
-- ENUM ADD VALUE only, in its own file (as 0056), so it is committed before 0138
-- uses it. No rollback for an enum value (Postgres can't drop one); harmless unused.

alter type loan_doc_category add value if not exists 'completion_other';
