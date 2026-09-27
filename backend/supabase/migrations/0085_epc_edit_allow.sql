-- 0085 — Capital-Craft-granted edit scope for a locked EPC application.
--
-- After an EPC submits, the file is LOCKED (0084). The Capital Craft team opens
-- editing for specific fields/documents by sending a "Message to EPC" and
-- ticking rows in the edit table on that window. Those ticked keys are stored
-- here; the EPC's edit chatbot then shows ONLY these rows, and the loan-apply
-- submit route allows a resubmit while this grant is non-empty, clearing it
-- again on submit (so each grant is single-use).
--
-- Keys match the EPC edit picker: aadhaar, pan, ebill, rooftop, selfie, bank,
-- coapp_aadhaar, coapp_pan, coapp_mobile, borrower_email, install_pincode,
-- system_type, plant_use_type, quotation, loan_amount, loan_config.
-- Additive, default empty (existing rows carry no grant).
alter table public.epc_applications
  add column if not exists edit_allow text[] not null default '{}';
