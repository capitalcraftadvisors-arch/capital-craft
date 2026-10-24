-- 0101 — Dead loan leads are deleted 30 days after they were marked dead.
--
-- A lead marked dead (loan_leads.dead_at) is kept for 30 days — revive it
-- (dead_at → null) within that time and it stays. After that it is deleted
-- with its comments (lead_comments, FK cascade) and its My Day follow-up row
-- (ops_case_touch, source 'lead'). Loan leads hold no uploaded files.
-- Runs daily inside the database (pg_cron) — no app requests.

create extension if not exists pg_cron;

create or replace function purge_dead_loan_leads() returns int
language plpgsql security definer set search_path = public as $$
declare
  ids uuid[];
  n int;
begin
  select coalesce(array_agg(id), '{}') into ids
    from loan_leads where dead_at is not null and dead_at < now() - interval '30 days';
  delete from ops_case_touch where source = 'lead' and case_id = any(ids);
  delete from loan_leads where id = any(ids);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function purge_dead_loan_leads() from public, anon, authenticated;

-- Daily at 03:00 India time (21:30 UTC). Re-running this file replaces the job.
select cron.unschedule(jobid) from cron.job where jobname = 'purge-dead-loan-leads';
select cron.schedule('purge-dead-loan-leads', '30 21 * * *', 'select public.purge_dead_loan_leads()');
