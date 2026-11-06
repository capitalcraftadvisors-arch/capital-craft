-- 0117 — EPC Settings (partner portal): what the partner sets for its own
-- organization, beside the KYC details CC verified (those stay on epc_business,
-- read-only). One row per EPC (epc_org_profile, 0116) serves the Settings pages
-- and the quotation PDF in one read.
--
--   Organization   display_name, address_line, city, state, pincode, phone, email, website
--   Branding       accent (#rrggbb), signature_path, stamp_path   (logo_path: 0116)
--   Quotations     quote_prefix, quote_next (the next number), gst_mode,
--                  quote_defaults — { validity: {residential, commercial} (days),
--                  payment: {residential, commercial} ([stage, %][]), timeline: {…},
--                  warranty: [component, text][], terms, notes }

alter table public.epc_org_profile
  add column if not exists display_name   text,
  add column if not exists address_line   text,
  add column if not exists city           text,
  add column if not exists state          text,
  add column if not exists pincode        text,
  add column if not exists phone          text,
  add column if not exists email          text,
  add column if not exists website        text,
  add column if not exists accent         text,
  add column if not exists signature_path text,
  add column if not exists stamp_path     text,
  add column if not exists quote_prefix   text not null default 'Q-',
  add column if not exists quote_next     integer not null default 1,
  add column if not exists gst_mode       text not null default 'blended',
  add column if not exists quote_defaults jsonb not null default '{}'::jsonb;

do $$ begin
  alter table public.epc_org_profile add constraint epc_org_profile_accent_hex check (accent is null or accent ~ '^#[0-9a-fA-F]{6}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.epc_org_profile add constraint epc_org_profile_gst_mode check (gst_mode in ('blended', 'lines'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.epc_org_profile add constraint epc_org_profile_quote_next check (quote_next >= 1);
exception when duplicate_object then null; end $$;
