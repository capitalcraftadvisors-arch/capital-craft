-- =========================================================
-- 0054 — Business Expectation: normalize all values to ₹ Lakhs
--
-- The field was stored as a number + a Crores/Lakhs unit:
--   business_expectation        text     'crores' | 'lakhs'
--   business_expectation_value  numeric  the number
--
-- The UI is dropping the unit dropdown — the value is now always in
-- ₹ Lakhs. This one-time migration normalizes existing rows so displayed
-- numbers stay correct: Crore values are multiplied by 100, and the unit
-- is set to 'lakhs' for every previously-Crore row.
--
-- ⚠️  TAKE A CSV BACKUP FIRST (see the backup SELECT provided separately).
--     This UPDATE mutates data and is only cleanly reversible from that
--     backup.
--
-- Rollback (approximate — restores unit, undoes the ×100 for converted
-- rows; exact restore should come from the CSV backup):
--   update epc_business
--      set business_expectation_value = business_expectation_value / 100
--    where business_expectation = 'lakhs' and business_expectation_value is not null;
--   -- (unit cannot be un-normalized without the backup — rows that were
--   --  genuinely 'lakhs' before are indistinguishable afterwards.)
-- =========================================================

-- SAFETY BACKUP: snapshot the pre-mutation values into a standalone table
-- BEFORE any UPDATE runs. `if not exists` makes a re-run a no-op, so the very
-- first (pre-mutation) snapshot is preserved even if this migration is applied
-- again. Restore or export to CSV from here anytime:
--   select * from epc_business_expectation_backup_0054;
create table if not exists epc_business_expectation_backup_0054 as
  select id, epc_display_id, business_expectation, business_expectation_value,
         now() as backed_up_at
    from epc_business
   where business_expectation is not null or business_expectation_value is not null;

-- Crore amounts → Lakhs (×100). Do the value first, then the unit.
update epc_business
   set business_expectation_value = business_expectation_value * 100
 where business_expectation = 'crores'
   and business_expectation_value is not null;

-- Normalize the unit to 'lakhs' for every previously-Crore row.
update epc_business
   set business_expectation = 'lakhs'
 where business_expectation = 'crores';
