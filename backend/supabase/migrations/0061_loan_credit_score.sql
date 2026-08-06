-- 0061_loan_credit_score.sql
-- Lender credit score captured at approval (required: a positive integer or
-- explicitly "None") and optionally at rejection. Shown on the loan profile's
-- Approval-details card. Nullable = "None" / not provided.

alter table epc_applications
  add column if not exists credit_score integer;
