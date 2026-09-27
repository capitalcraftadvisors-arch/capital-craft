-- 0087 — EPC onboarding Step 4 additions.
--
-- Two new required inputs at Step 4 (Bank details):
--   • gst_username — the EPC's GST portal login username (text on epc_business).
--   • bank_statement — a new epc_documents category for the 12 monthly bank
--     statements the EPC uploads at Step 4. Deduplicated client-side by a
--     content hash stored in epc_documents.metadata.content_hash.
--
-- (GST R3B is a SEPARATE, team-uploaded doc — category gst_r3b — untouched here.)
alter table public.epc_business
  add column if not exists gst_username text;

-- New enum value for the bank-statement docs (ADD VALUE must run outside a txn —
-- the runner executes this statement on its own).
alter type public.epc_doc_category add value if not exists 'bank_statement';
