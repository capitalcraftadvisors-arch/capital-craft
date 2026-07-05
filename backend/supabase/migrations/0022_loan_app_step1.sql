-- =========================================================
-- 0022 — Loan application Step 1 (Registration)
--
-- Adds columns to epc_applications needed for Step 1's fields and
-- for the consent + WhatsApp confirmation flow. All new columns
-- are NULLABLE (with sensible defaults where a NOT NULL default
-- makes sense). No historical backfill — any existing loan-app
-- rows stay at current_step=1 / whatsapp='not_sent' by default,
-- which is exactly correct: they haven't been through Step 1.
--
-- Related pieces:
--   /api/admin/loan-app/[id]/complete-step-1  writes consent_* and
--       fires the WhatsApp stub, then advances current_step to 2.
--   admin/src/lib/whatsapp.ts  holds the sendWhatsAppConfirmation
--       stub — one-line swap when AiSensy creds land.
--
-- Rollback: see the block at the bottom.
-- =========================================================


-- ── Solar system preference enum ─────────────────────────────
-- Wrapped in a DO block so re-running the migration is safe.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'loan_system_type') then
    create type loan_system_type as enum ('off_grid', 'on_grid', 'hybrid');
  end if;
end $$;


-- ── Progress tracking ────────────────────────────────────────
-- Mirrors epc_business.current_step. Step 1 leaves this at 1 until
-- the admin clicks Send confirmation; complete-step-1 advances it
-- to 2. Later step routes advance further.
alter table epc_applications
  add column if not exists current_step smallint not null default 1;


-- ── Installation site (distinct from borrower's residence) ───
-- The existing borrower_pincode / borrower_state / borrower_city
-- columns describe where the BORROWER lives. These new columns
-- describe where the solar system will be INSTALLED. In many
-- cases the two match, but the spec (and downstream credit
-- underwriting) treats them as distinct.
alter table epc_applications
  add column if not exists install_pincode  text,
  add column if not exists install_state    text,
  add column if not exists install_district text,
  add column if not exists install_city     text;


-- ── System preference chosen at Step 1 ──────────────────────
alter table epc_applications
  add column if not exists system_type loan_system_type;


-- ── Consent record (legal breadcrumb) ────────────────────────
-- consent_policies snapshots WHICH policies were agreed to at
-- click time, e.g. ["terms_conditions","privacy_policy",
-- "cookie_policy","credit_information","loan_application"]. If
-- the policy wording changes later, we still have a durable
-- record of the version the borrower accepted.
alter table epc_applications
  add column if not exists consent_at         timestamptz,
  add column if not exists consent_policies   jsonb,
  add column if not exists consent_ip         inet,
  add column if not exists consent_user_agent text;


-- ── WhatsApp confirmation state ──────────────────────────────
-- Statuses:
--   not_sent  — never attempted (default for legacy + fresh rows)
--   sent      — send call succeeded (in stub mode this fires immediately)
--   confirmed — user tapped the WhatsApp reply (live-mode only)
--   failed    — provider returned an error
alter table epc_applications
  add column if not exists whatsapp_confirmation_status text not null default 'not_sent'
    check (whatsapp_confirmation_status in ('not_sent','sent','confirmed','failed')),
  add column if not exists whatsapp_sent_at         timestamptz,
  add column if not exists whatsapp_confirmed_at    timestamptz,
  add column if not exists whatsapp_provider_msg_id text;


-- =========================================================
-- Rollback (destructive — drop columns + enum):
--   alter table epc_applications drop column if exists whatsapp_provider_msg_id;
--   alter table epc_applications drop column if exists whatsapp_confirmed_at;
--   alter table epc_applications drop column if exists whatsapp_sent_at;
--   alter table epc_applications drop column if exists whatsapp_confirmation_status;
--   alter table epc_applications drop column if exists consent_user_agent;
--   alter table epc_applications drop column if exists consent_ip;
--   alter table epc_applications drop column if exists consent_policies;
--   alter table epc_applications drop column if exists consent_at;
--   alter table epc_applications drop column if exists system_type;
--   alter table epc_applications drop column if exists install_city;
--   alter table epc_applications drop column if exists install_district;
--   alter table epc_applications drop column if exists install_state;
--   alter table epc_applications drop column if exists install_pincode;
--   alter table epc_applications drop column if exists current_step;
--   drop type if exists loan_system_type;
-- =========================================================
