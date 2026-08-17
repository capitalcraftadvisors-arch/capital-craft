-- =========================================================
-- 0067 — RM case-scoping (Row-Level Security for the Ops Board).
--
-- Until now every admin-type user (MAIN_ADMIN and OPERATIONS_USER alike) could
-- read ALL rows of the three "case" tables via the permissive admin_all_*
-- policies. The Ops Board requires that a Relationship Manager (OPERATIONS_USER,
-- e.g. Manish / Malvika) can only ever see the cases ASSIGNED to them — enforced
-- in the database, not just hidden in the UI — while a MAIN_ADMIN keeps seeing
-- everything.
--
-- We REPLACE the admin_all_* policies on epc_applications, insurance_applications
-- and loan_leads with a scoped version:
--   • business_type='admin' AND (
--       hierarchy_role <> 'OPERATIONS_USER'          -- MAIN_ADMIN or legacy admin → ALL
--       OR assigned_to_user_id = caller's business_id -- OPERATIONS_USER → only assigned
--     )
-- `hierarchy_role` is read straight off the JWT (minted in 0066 / the auth fn).
-- A legacy admin token without hierarchy_role is treated as full-access (back-
-- compat), mirroring lib/hierarchy.ts isMainAdmin().
--
-- with check uses the same predicate so an RM can only insert/update rows that
-- remain assigned to them; a MAIN_ADMIN can assign/reassign to anyone.
--
-- epc_business is deliberately NOT scoped here — it is shared infrastructure
-- (EPC partner list, loan-app creation picker); EPC onboarding cases on the
-- board are scoped in the app layer instead.
--
-- Rollback: restore each admin_all_* policy to `using ((auth.jwt() ->>
-- 'business_type') = 'admin')`.
-- =========================================================

-- Reusable predicate, inlined per table (Postgres RLS can't share a fragment).
-- Kept identical across all three so behaviour is uniform.

-- ── epc_applications ─────────────────────────────────────────────────────
drop policy if exists "admin_all_applications" on epc_applications;
create policy "admin_scoped_applications" on epc_applications for all
  using (
    (auth.jwt() ->> 'business_type') = 'admin'
    and (
      coalesce(auth.jwt() ->> 'hierarchy_role', '') <> 'OPERATIONS_USER'
      or assigned_to_user_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
    )
  )
  with check (
    (auth.jwt() ->> 'business_type') = 'admin'
    and (
      coalesce(auth.jwt() ->> 'hierarchy_role', '') <> 'OPERATIONS_USER'
      or assigned_to_user_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
    )
  );

-- ── insurance_applications ───────────────────────────────────────────────
drop policy if exists "admin_all_insurance" on insurance_applications;
create policy "admin_scoped_insurance" on insurance_applications for all
  using (
    (auth.jwt() ->> 'business_type') = 'admin'
    and (
      coalesce(auth.jwt() ->> 'hierarchy_role', '') <> 'OPERATIONS_USER'
      or assigned_to_user_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
    )
  )
  with check (
    (auth.jwt() ->> 'business_type') = 'admin'
    and (
      coalesce(auth.jwt() ->> 'hierarchy_role', '') <> 'OPERATIONS_USER'
      or assigned_to_user_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
    )
  );

-- ── loan_leads ───────────────────────────────────────────────────────────
drop policy if exists "loan_leads_admin_all" on loan_leads;
create policy "loan_leads_admin_scoped" on loan_leads for all
  using (
    (auth.jwt() ->> 'business_type') = 'admin'
    and (
      coalesce(auth.jwt() ->> 'hierarchy_role', '') <> 'OPERATIONS_USER'
      or assigned_to_user_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
    )
  )
  with check (
    (auth.jwt() ->> 'business_type') = 'admin'
    and (
      coalesce(auth.jwt() ->> 'hierarchy_role', '') <> 'OPERATIONS_USER'
      or assigned_to_user_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
    )
  );
