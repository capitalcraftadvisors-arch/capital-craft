-- =========================================================
-- Capital Craft — seed admin accounts (per architecture §5.4)
-- These admins log in with the same mobile + 1234 OTP flow.
-- Adjust mobile numbers before production.
-- =========================================================

insert into epc_business
  (contact_name, contact_mobile, contact_designation, business_type, status)
values
  ('Admin One', '7300085802', 'Ops Lead', 'admin', 'approved'),
  ('Admin Two', '9999900002', 'Ops',      'admin', 'approved')
on conflict (contact_mobile) do nothing;
