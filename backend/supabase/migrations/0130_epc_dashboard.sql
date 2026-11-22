-- 0130 — The Partner Portal v2 dashboard in one read (23/11/2026). Additive: one
-- new function; no table, rule or existing function changes.
--
-- epc_dashboard(p_from, p_to) — every figure and list of the new partner dashboard
-- as one jsonb. Invoker rights: the caller's own rules (0120 / 0127 / 0128 / 0129)
-- scope each number — Sales count only their own leads / projects / loans, Site
-- staff read no money, a staff login without Loans / Insurance gets none of those.
--
-- The period (India dates, both ends included; null = all time) applies to
-- projects.created_at, leads.created_at, payments.paid_on and loans.submitted_at.
-- The lists (attention, follow-ups, payments due, insurance due) are as of today
-- (India time), whatever the period.
--
--   summary          project value, projects, kW, received (payments in the period),
--                    pending (the period's projects: cost − all their payments, ≥ 0)
--   split            cash / loan / part loan: {count, value} of the period's projects
--   pipeline         leads → contacted → quoted → won (a lead counts at every stage
--                    it has reached) · loans filed → approved → 1st tranche → 2nd pending
--   attention        up to 10, a few of each kind: CC message on a loan, payment
--                    overdue, follow-up overdue, policy ending in ≤ 15 days, installed
--                    but not insured, a project > 7 days in one stage (not Loan in process)
--   followups_today  open leads with a follow-up today or earlier
--   lead_owners      Owner / Admin only: leads + won (period) and follow-ups due per owner
--   payments_due     projects with a balance, newest due date first (50)
--   loans            the portal's 4 loan stages (stage4, src/app/dashboard/page.tsx)
--                    + sanctioned / disbursed amounts
--   insurance_due    issued policies ending within 30 days either side of today
--
-- rollback: drop function if exists epc_dashboard(date, date);

create or replace function public.epc_dashboard(p_from date default null, p_to date default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with
ctx as (
  select (now() at time zone 'Asia/Kolkata')::date as today,
         nullif(auth.jwt() ->> 'business_id', '')::uuid as biz,
         epc_member_role() as role,
         (select nullif(btrim(b.contact_name), '') from epc_business b
           where b.id = nullif(auth.jwt() ->> 'business_id', '')::uuid) as company,
         coalesce(p_from, '-infinity'::date) as d_from,
         coalesce(p_to, 'infinity'::date) as d_to
),
-- Projects the caller sees, their cost and everything paid on them so far.
pr as (
  select p.id, p.customer_name, p.mobile, p.kw, p.payment_mode, p.stage, p.stage_at, p.created_at,
         p.application_id, p.insurance_application_id,
         f.project_cost, f.payment_due_on,
         coalesce(pay.paid, 0) as received,
         greatest(coalesce(f.project_cost, 0) - coalesce(pay.paid, 0), 0) as balance,
         (p.created_at at time zone 'Asia/Kolkata')::date between ctx.d_from and ctx.d_to as in_period
    from ctx
    join epc_projects p on p.business_id = ctx.biz
    left join epc_project_finance f on f.project_id = p.id
    left join (select x.project_id, sum(x.amount) as paid
                 from epc_project_payments x, ctx
                where x.business_id = ctx.biz
                group by x.project_id) pay on pay.project_id = p.id
),
-- Leads the caller sees; a lead with no staff owner is the company's (its contact name).
ld as (
  select l.id, l.name, l.mobile, l.status, l.follow_up_at, l.owner_member_id,
         coalesce(nullif(btrim(m.name), ''), ctx.company, 'Owner') as owner,
         (l.created_at at time zone 'Asia/Kolkata')::date between ctx.d_from and ctx.d_to as in_period,
         coalesce(l.status not in ('won', 'lost') and l.follow_up_at <= ctx.today, false) as due
    from ctx
    join epc_leads l on l.business_id = ctx.biz
    left join epc_members m on m.id = l.owner_member_id
),
-- Loans the caller sees (no blank drafts, as the portal lists them) at the portal's
-- 4 stages. All time: every listed loan; a period: those submitted in it.
ln as (
  select a.id, coalesce(nullif(btrim(a.borrower_name), ''), nullif(btrim(a.aadhaar_name), ''), 'Customer') as name,
         a.submitted_at, a.attention_status, a.attention_raised_at, a.insurance_application_id,
         a.sanctioned_amount, a.first_disbursement_amount, a.second_disbursement_amount,
         case when a.status = 'rejected' then 'rejected'
              when a.status in ('approved', 'sent_to_nbfc', 'disbursed') then 'approved'
              when a.epc_updated_at is not null then 'updated'
              else 'under_review' end as stage,
         case when p_from is null and p_to is null then true
              else coalesce((a.submitted_at at time zone 'Asia/Kolkata')::date between ctx.d_from and ctx.d_to, false) end as in_period
    from ctx
    join epc_applications a on a.epc_business_id = ctx.biz
   where not (a.status = 'draft' and a.aadhaar_front_path is null)
),
-- Issued policies ending within 30 days either side of today.
ins as (
  select i.id, coalesce(nullif(btrim(i.aadhaar_name), ''), 'Customer') as name, i.policy_to_date,
         i.policy_to_date - ctx.today as days_left
    from ctx
    join insurance_applications i on i.epc_business_id = ctx.biz
   where i.status = 'issued' and i.policy_to_date between ctx.today - 30 and ctx.today + 30
),
-- What needs the EPC today; rn spreads the 10 places over the kinds.
attn as (
  select a.kind, a.id, a.title, a.detail, a.amount, a.rank,
         row_number() over (partition by a.kind order by a.sort_at) as rn
    from (
      select 'loan' as kind, 1 as rank, ln.id, ln.name as title, 'Message from Capital Craft' as detail,
             null::numeric as amount, -extract(epoch from coalesce(ln.attention_raised_at, now())) as sort_at
        from ln
       where ln.attention_status = 'open'
      union all
      select 'payment', 2, pr.id, pr.customer_name, 'Payment due ' || to_char(pr.payment_due_on, 'DD/MM/YYYY'),
             pr.balance, extract(epoch from pr.payment_due_on::timestamp)
        from pr, ctx
       where pr.payment_due_on < ctx.today and pr.balance > 0
      union all
      select 'followup', 3, ld.id, ld.name, 'Follow-up due ' || to_char(ld.follow_up_at, 'DD/MM/YYYY'),
             null, extract(epoch from ld.follow_up_at::timestamp)
        from ld, ctx
       where ld.status not in ('won', 'lost') and ld.follow_up_at < ctx.today
      union all
      select 'insurance', 4, ins.id, ins.name, 'Policy ends ' || to_char(ins.policy_to_date, 'DD/MM/YYYY'),
             null, ins.days_left
        from ins
       where ins.days_left between 0 and 15
      union all
      -- Installed (or later) with no policy: neither on the project nor on its loan (0112).
      select 'not_insured', 5, pr.id, pr.customer_name, 'Not insured', null, -extract(epoch from pr.stage_at)
        from pr
        left join ln on ln.id = pr.application_id
       where pr.stage in ('installation_done', 'net_metering_applied', 'commissioned', 'closed')
         and pr.insurance_application_id is null and ln.insurance_application_id is null
      union all
      select 'stuck', 6, pr.id, pr.customer_name,
             (case pr.stage
                when 'quote_won' then 'Quote won'
                when 'site_survey' then 'Site survey'
                when 'loan_in_process' then 'Loan in process'
                when 'material_dispatched' then 'Material dispatched'
                when 'installation_done' then 'Installation done'
                when 'net_metering_applied' then 'Net metering applied'
                when 'commissioned' then 'Commissioned'
                else pr.stage end)
               || ' · ' || floor(extract(epoch from now() - pr.stage_at) / 86400)::int || ' days',
             null, extract(epoch from pr.stage_at)
        from pr
       where pr.stage not in ('closed', 'loan_in_process') and pr.stage_at < now() - interval '7 days' -- a loan waits on the lender
    ) a
)
select jsonb_build_object(
  'summary', (
    select jsonb_build_object(
      'project_value', coalesce(sum(pr.project_cost), 0),
      'projects',      count(*),
      'kw',            coalesce(sum(pr.kw), 0),
      'received',      (select coalesce(sum(x.amount), 0)
                          from epc_project_payments x, ctx
                         where x.business_id = ctx.biz and x.paid_on between ctx.d_from and ctx.d_to),
      'pending',       coalesce(sum(pr.balance), 0))
      from pr where pr.in_period),
  'split', (
    select jsonb_build_object(
      'cash',      jsonb_build_object('count', count(*) filter (where pr.payment_mode = 'cash'),
                                      'value', coalesce(sum(pr.project_cost) filter (where pr.payment_mode = 'cash'), 0)),
      'loan',      jsonb_build_object('count', count(*) filter (where pr.payment_mode = 'loan'),
                                      'value', coalesce(sum(pr.project_cost) filter (where pr.payment_mode = 'loan'), 0)),
      'part_loan', jsonb_build_object('count', count(*) filter (where pr.payment_mode = 'part_loan'),
                                      'value', coalesce(sum(pr.project_cost) filter (where pr.payment_mode = 'part_loan'), 0)))
      from pr where pr.in_period),
  'pipeline', (
    select jsonb_build_object(
      'leads',     count(*),
      'contacted', count(*) filter (where ld.status in ('contacted', 'quoted', 'won')),
      'quoted',    count(*) filter (where ld.status in ('quoted', 'won')),
      'won',       count(*) filter (where ld.status = 'won'))
      from ld where ld.in_period)
    || (
    select jsonb_build_object(
      'loans_filed',    count(*),
      'approved',       count(*) filter (where ln.stage = 'approved'),
      'first_tranche',  count(*) filter (where ln.stage = 'approved' and ln.first_disbursement_amount is not null),
      'second_pending', count(*) filter (where ln.stage = 'approved' and ln.first_disbursement_amount is not null
                                                and ln.second_disbursement_amount is null))
      from ln where ln.submitted_at is not null and ln.in_period),
  'attention', coalesce((
    select jsonb_agg(jsonb_build_object('kind', t.kind, 'id', t.id, 'title', t.title, 'detail', t.detail, 'amount', t.amount)
                     order by t.rn, t.rank)
      from (select * from attn order by attn.rn, attn.rank limit 10) t), '[]'::jsonb),
  'followups_today', coalesce((
    select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'mobile', t.mobile, 'follow_up_at', t.follow_up_at, 'owner', t.owner)
                     order by t.follow_up_at, t.name)
      from (select * from ld where ld.due order by ld.follow_up_at, ld.name limit 20) t), '[]'::jsonb),
  'lead_owners', case when (select ctx.role from ctx) in ('OWNER', 'ADMIN') then coalesce((
    select jsonb_agg(jsonb_build_object('member_id', o.member_id, 'name', o.name, 'leads', o.leads, 'won', o.won, 'due', o.due)
                     order by o.leads desc, o.due desc, o.name)
      from (select ld.owner_member_id as member_id, min(ld.owner) as name,
                   count(*) filter (where ld.in_period) as leads,
                   count(*) filter (where ld.in_period and ld.status = 'won') as won,
                   count(*) filter (where ld.due) as due
              from ld group by ld.owner_member_id) o
     where o.leads > 0 or o.due > 0), '[]'::jsonb) else '[]'::jsonb end,
  'payments_due', coalesce((
    select jsonb_agg(jsonb_build_object('id', t.id, 'customer', t.customer_name, 'mobile', t.mobile, 'cost', t.project_cost,
                                        'received', t.received, 'balance', t.balance, 'due_on', t.payment_due_on)
                     order by t.payment_due_on desc nulls last, t.created_at desc)
      from (select * from pr where pr.balance > 0
             order by pr.payment_due_on desc nulls last, pr.created_at desc limit 50) t), '[]'::jsonb),
  'loans', (
    select jsonb_build_object(
      'under_review', count(*) filter (where ln.stage = 'under_review'),
      'updated',      count(*) filter (where ln.stage = 'updated'),
      'approved',     count(*) filter (where ln.stage = 'approved'),
      'rejected',     count(*) filter (where ln.stage = 'rejected'),
      'sanctioned',   coalesce(sum(ln.sanctioned_amount), 0),
      'disbursed',    coalesce(sum(coalesce(ln.first_disbursement_amount, 0) + coalesce(ln.second_disbursement_amount, 0)), 0))
      from ln where ln.in_period),
  'insurance_due', coalesce((
    select jsonb_agg(jsonb_build_object('id', ins.id, 'name', ins.name, 'policy_to_date', ins.policy_to_date, 'days_left', ins.days_left)
                     order by ins.policy_to_date)
      from ins), '[]'::jsonb)
);
$$;

revoke all on function public.epc_dashboard(date, date) from public;
grant execute on function public.epc_dashboard(date, date) to authenticated;
