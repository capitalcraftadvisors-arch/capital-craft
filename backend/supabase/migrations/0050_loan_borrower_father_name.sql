-- Applicant (borrower) father's name, read from the PAN card OCR.
--
-- The PAN parser (admin/src/lib/pan-parser.ts) already extracts father_name;
-- the loan flow simply had nowhere to store it for the APPLICANT (only the
-- co-applicant had coapp_father_name, migration 0024). This adds the column.
-- Nullable and backfill-free — existing rows keep NULL until the PAN is
-- re-read or edited. No parser change is needed.
--
-- rollback:
--   alter table epc_applications drop column if exists borrower_father_name;

alter table epc_applications
  add column if not exists borrower_father_name text;
