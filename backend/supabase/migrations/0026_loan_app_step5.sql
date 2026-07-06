-- =========================================================
-- 0026 — Loan application Step 5 (Loan Offers)
--
-- Additive columns on epc_applications for:
--   - ROI + subsidy inputs (RM-facing)
--   - Selected tenure + computed EMIs
--   - Step-5 completion timestamp
--
-- Schema state we're REUSING (no new columns needed):
--   - status         (loan_status enum from 0001) — already includes
--                    'draft' + 'submitted'. Page 6 sets status='submitted'
--                    on final submit.
--   - submitted_at   (timestamptz from 0001) — Page 6 sets to now() on
--                    final submit.
--
-- All new columns are NULLABLE with no backfill. Existing rows keep
-- NULL until their application reaches Step 5.
--
-- The application record stays EDITABLE after submit — Page 6 does not
-- lock anything. There is no row-level trigger blocking further updates.
--
-- Rollback: see block at the bottom.
-- =========================================================


-- ── RM / lender inputs ───────────────────────────────────────
-- roi_percent: enforced client + server side to 7.5 – 10.8.
-- Numeric to preserve half-decimal precision (e.g. 8.25).
alter table epc_applications
  add column if not exists roi_percent      numeric(5,2),
  add column if not exists central_subsidy  numeric(12,2),
  add column if not exists state_subsidy    numeric(12,2);


-- ── Selection ────────────────────────────────────────────────
-- selected_tenure_years: 1..5 (5 tenure cards on Step 5).
-- Both EMI columns store the rupee amount at the moment the customer
-- confirmed Step 5. Kept as separate columns (not derived) so the
-- Page 6 review + downstream disbursal display exactly what the
-- customer saw at signing — not a fresh recompute against later
-- ROI adjustments.
alter table epc_applications
  add column if not exists selected_tenure_years  smallint
    check (selected_tenure_years is null
        or (selected_tenure_years between 1 and 5)),
  add column if not exists selected_monthly_emi   numeric(14,2),
  add column if not exists selected_subsidy_emi   numeric(14,2);


-- ── Progress timestamp ───────────────────────────────────────
alter table epc_applications
  add column if not exists step5_completed_at timestamptz;


-- =========================================================
-- Rollback (destructive):
--   alter table epc_applications drop column if exists step5_completed_at;
--   alter table epc_applications drop column if exists selected_subsidy_emi;
--   alter table epc_applications drop column if exists selected_monthly_emi;
--   alter table epc_applications drop column if exists selected_tenure_years;
--   alter table epc_applications drop column if exists state_subsidy;
--   alter table epc_applications drop column if exists central_subsidy;
--   alter table epc_applications drop column if exists roi_percent;
-- =========================================================
