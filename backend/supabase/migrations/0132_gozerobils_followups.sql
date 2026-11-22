-- 0132 — gozerobils leads: follow-ups and calls (23/11/2026). The gozerobils
-- Leads window (main admin) gets All leads / My Day / Calls tabs: every call is
-- logged with its outcome, a note and the next follow-up date; My Day lists the
-- follow-ups due and the new leads not called yet. Additive: four columns on
-- gozerobils_leads (0123) and one table; the form API (gozerobils_save_lead)
-- never touches them.
--
-- rollback: drop table if exists gozerobils_lead_calls;
--           alter table gozerobils_leads drop column if exists follow_up_at, drop column if exists last_call_at,
--             drop column if exists last_outcome, drop column if exists call_count;

alter table public.gozerobils_leads
  add column if not exists follow_up_at date,             -- the next call
  add column if not exists last_call_at timestamptz,
  add column if not exists last_outcome text,
  add column if not exists call_count   integer not null default 0;

create index if not exists gozerobils_leads_follow_up_idx on public.gozerobils_leads (follow_up_at) where follow_up_at is not null;

create table if not exists public.gozerobils_lead_calls (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references public.gozerobils_leads(id) on delete cascade,
  called_at      timestamptz not null default now(),
  outcome        text not null check (outcome in ('connected', 'interested', 'call_back', 'not_interested',
                                                   'no_answer', 'busy', 'switched_off', 'wrong_number')),
  note           text,
  next_follow_up date,
  created_at     timestamptz not null default now()
);
create index if not exists gozerobils_lead_calls_lead_idx on public.gozerobils_lead_calls (lead_id, called_at desc);
create index if not exists gozerobils_lead_calls_recent_idx on public.gozerobils_lead_calls (called_at desc);

alter table public.gozerobils_lead_calls enable row level security;
drop policy if exists gozerobils_lead_calls_admin on public.gozerobils_lead_calls;
create policy gozerobils_lead_calls_admin on public.gozerobils_lead_calls for all to authenticated
  using (auth.jwt() ->> 'business_type' = 'admin')
  with check (auth.jwt() ->> 'business_type' = 'admin');

-- A logged call updates its lead: last call + outcome, the count, the next
-- follow-up (the one given, else none), and a New lead becomes Contacted.
create or replace function gozerobils_call_logged() returns trigger
language plpgsql set search_path = public as $$
begin
  update gozerobils_leads
     set last_call_at = new.called_at, last_outcome = new.outcome, call_count = call_count + 1,
         follow_up_at = new.next_follow_up,
         status = case when status = 'new' then 'contacted' else status end,
         updated_at = now()
   where id = new.lead_id;
  return new;
end $$;
drop trigger if exists trg_gozerobils_call_logged on public.gozerobils_lead_calls;
create trigger trg_gozerobils_call_logged after insert on public.gozerobils_lead_calls
  for each row execute function gozerobils_call_logged();
