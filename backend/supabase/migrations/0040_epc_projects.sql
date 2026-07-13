-- =========================================================
-- 0040 — EPC Projects: admin-only per-EPC project stats
--
-- A 2×5 grid the admin fills during review:
--   columns : Residential | Commercial
--   rows    : Applications submitted / Applications rejected /
--             Sanction amount / Disbursed / Pending disbursal
--
-- Storage: ONE jsonb column on epc_admin_info (already admin-only RLS —
-- the "admin_all_epc_admin_info" policy with NO EPC policy makes it
-- invisible to EPCs, exactly like the other admin-only fields there).
-- Nullable, no default: existing rows / EPCs read null → an empty grid
-- until an admin fills it. epc_admin_info rows are lazy (created on first
-- Save), so no backfill is needed.
--
-- Shape:
--   {
--     "residential": {
--       "applications_submitted": <number>,
--       "applications_rejected":  <number>,
--       "sanction_amount":        <number>,
--       "disbursed":              <number>,
--       "pending_disbursal":      <number>
--     },
--     "commercial": { ...same keys... }
--   }
--
-- Rollback:
--   alter table epc_admin_info drop column epc_projects;
-- =========================================================

alter table epc_admin_info
  add column if not exists epc_projects jsonb;

comment on column epc_admin_info.epc_projects is
  'Admin-only EPC project stats (Residential/Commercial x 5 metrics). Null until admin fills.';
