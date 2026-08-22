-- 0069 — Scrub the placeholder admin name "Sunil Jadaun" from the system.
--
-- The prod admin account's contact_name was "Sunil Jadaun" (placeholder — there
-- is no such person). It surfaced everywhere the admin's name is shown: the
-- activity log actor (live-joined from epc_business.contact_name), comment
-- authors (snapshotted author_name), and the loan activity trail (actor_name).
-- Rename the account to "Admin" and rewrite the historical snapshots.
--
-- Idempotent + name-scoped (ILIKE '%sunil%jadaun%'), so it only touches the
-- placeholder rows and is a no-op on any project that never had that name.

update epc_business
   set contact_name = 'Admin'
 where business_type = 'admin'
   and contact_name ilike '%sunil%jadaun%';

update loan_comments set author_name = 'Admin' where author_name ilike '%sunil%jadaun%';
update epc_comments  set author_name = 'Admin' where author_name ilike '%sunil%jadaun%';
update lead_comments set author_name = 'Admin' where author_name ilike '%sunil%jadaun%';

update loan_activity_log set actor_name = 'Admin' where actor_name ilike '%sunil%jadaun%';
