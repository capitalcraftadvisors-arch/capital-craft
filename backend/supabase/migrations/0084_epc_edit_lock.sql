-- 0084 — EPC application edit lock.
--
-- A submitted application is LOCKED so the EPC can't keep editing it. The
-- Capital Craft team unlocks it from the admin loan table (a lock toggle) to
-- let the EPC make changes; the EPC's Edit button stays disabled while locked.
-- Additive, default false (existing rows stay unlocked/editable).
alter table public.epc_applications
  add column if not exists edit_locked boolean not null default false;
