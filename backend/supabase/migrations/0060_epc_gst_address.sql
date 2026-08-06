-- 0060_epc_gst_address.sql
-- Manual GST registered-address field on the EPC business (item 2 of the EPC
-- dashboard batch). Entered in onboarding + the edit page, shown in the
-- profile's Business details box. Additive, nullable.

alter table epc_business
  add column if not exists gst_address text;
