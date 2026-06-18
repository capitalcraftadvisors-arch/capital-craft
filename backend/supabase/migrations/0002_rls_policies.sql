-- =========================================================
-- Capital Craft — Row-Level Security policies
-- Pattern: per table, "own data" + "admin sees all" (OR'd).
-- =========================================================

-- Enable RLS on all tables
alter table epc_business          enable row level security;
alter table epc_documents         enable row level security;
alter table epc_applications      enable row level security;
alter table user_application_docs enable row level security;

-- ── epc_business: own row OR admin sees all ──
create policy "own_business" on epc_business for all
  using (id = (auth.jwt() ->> 'business_id')::uuid);
create policy "admin_all_business" on epc_business for all
  using ((auth.jwt() ->> 'business_type') = 'admin');

-- ── epc_documents: via business ownership ──
create policy "own_docs" on epc_documents for all
  using (business_id = (auth.jwt() ->> 'business_id')::uuid);
create policy "admin_all_docs" on epc_documents for all
  using ((auth.jwt() ->> 'business_type') = 'admin');

-- ── epc_applications: via business ownership ──
create policy "own_applications" on epc_applications for all
  using (epc_business_id = (auth.jwt() ->> 'business_id')::uuid);
create policy "admin_all_applications" on epc_applications for all
  using ((auth.jwt() ->> 'business_type') = 'admin');

-- ── user_application_docs: via application → business ownership ──
create policy "own_app_docs" on user_application_docs for all
  using (
    application_id in (
      select id from epc_applications
      where epc_business_id = (auth.jwt() ->> 'business_id')::uuid
    )
  );
create policy "admin_all_app_docs" on user_application_docs for all
  using ((auth.jwt() ->> 'business_type') = 'admin');
