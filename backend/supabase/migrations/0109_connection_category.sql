-- 0109 — The electricity connection's category on a loan application, asked
-- by the EPC chatbot: Domestic or Non-domestic. Shown on the admin loan view
-- (Loan requirement) and editable through Message to EPC. Null = not asked yet.
alter table epc_applications
  add column if not exists connection_category text
  check (connection_category is null or connection_category in ('domestic', 'non_domestic'));
