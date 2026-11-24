-- 0139 — Partner Portal v2 fixes before Sustera Ventures is switched on (25/11/2026).
-- Needs 0129 / 0130 (v2) and 0102 (customer applications). Replaces two functions
-- and three rules; no table changes.
--
-- 1. epc_projects_from_loans — the project made for each filed loan (the switch on
--    an EPC profile, and every first loan submit):
--      · an aborted loan gets no project (aborted_at, 0058);
--      · a disbursed loan starts at Material dispatched, not Loan in process;
--      · the project is dated by the loan's submit, not the day v2 was switched on,
--        so the dashboard's "this month" holds only this month's work.
-- 2. epc_dashboard — a loan project's lender money counts: what the lender paid is
--    "received" (in the period by its tranche dates; a "From lender" payment the EPC
--    typed in for the same money is not counted twice), and the lender's share (net
--    of its charges, 0111) is never in "Customer payments due" / payment overdue —
--    only what the customer owes. The lender figures come from epc_project_lender, so
--    a staff login without the Loans module sees the same money as the owner.
--    New: customer_apps — Customer applications in the period (quotations, PCRs,
--    agreements, with their prices), for the gozerobils builder (Sustera).
-- 3. customer_quotations (0102) — the same rules as the EPC's quotations (0120):
--    the Quotations module, and no Site staff; a Viewer reads only. Until now any
--    login of the company could read and change them through the database.
--
-- rollback: re-run the epc_projects_from_loans of 0129, the epc_dashboard of 0130
-- and the three customer_quotations policies of 0102; then
-- drop function if exists epc_project_lender(uuid);

-- ── 1. A project for every filed loan ─────────────────────────────────────────
-- One project per submitted loan of the company that is not rejected or aborted and
-- has none yet: payment Loan, the loan's project cost; Loan in process, or Material
-- dispatched once the lender has paid the 1st tranche; dated by the loan's submit.
-- (The later stages need site photos — the EPC moves it on.) Returns how many.
create or replace function epc_projects_from_loans(p_business uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer := 0;
  a record;
  v_project uuid;
begin
  if not (nullif(auth.jwt() ->> 'business_type', '') = 'admin'
          or p_business = nullif(auth.jwt() ->> 'business_id', '')::uuid
          or auth.jwt() is null) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  for a in
    select x.* from epc_applications x
     where x.epc_business_id = p_business and x.submitted_at is not null and x.status <> 'rejected'
       and x.aborted_at is null
       and not exists (select 1 from epc_projects p where p.application_id = x.id)
  loop
    insert into epc_projects (business_id, application_id, customer_name, mobile, city, kw, payment_mode, stage, created_by_member, created_at)
    values (p_business, a.id, coalesce(nullif(a.borrower_name, ''), nullif(a.aadhaar_name, ''), 'Customer'), a.borrower_mobile, a.install_city,
            case when lower(coalesce(a.project_size_unit, 'kw')) = 'mw' then a.project_size * 1000 else a.project_size end,
            'loan',
            case when a.first_disbursement_amount is not null then 'material_dispatched' else 'loan_in_process' end,
            a.created_by_member, a.submitted_at)
    returning id into v_project;
    insert into epc_project_finance (project_id, business_id, project_cost) values (v_project, p_business, a.total_project_cost);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function epc_projects_from_loans(uuid) from public;
grant execute on function epc_projects_from_loans(uuid) to authenticated;

-- ── 2a. A loan project's lender money ──────────────────────────────────────────
-- For one loan of the caller's company (not rejected or aborted): what the lender has
-- paid (both tranches), its whole share — sanctioned (else applied) less the lender's
-- 1st-tranche charges (0111), never below what it paid — and each tranche + its date.
-- Definer rights so the dashboard / a project shows the same money to every login that
-- can see the project (the loan itself needs the Loans module); never to Site staff.
create or replace function epc_project_lender(p_app uuid)
returns table (paid numeric, share numeric, first_amount numeric, first_date date, second_amount numeric, second_date date)
language sql stable security definer set search_path = public as $$
  select coalesce(a.first_disbursement_amount, 0) + coalesce(a.second_disbursement_amount, 0),
         greatest(coalesce(a.sanctioned_amount, a.loan_amount_required, 0)
                    - coalesce(a.first_processing_fee, 0) - coalesce(a.first_legal_charges, 0) - coalesce(a.first_cersai_charges, 0),
                  coalesce(a.first_disbursement_amount, 0) + coalesce(a.second_disbursement_amount, 0)),
         a.first_disbursement_amount, a.first_disbursement_date, a.second_disbursement_amount, a.second_disbursement_date
    from epc_applications a
   where a.id = p_app
     and a.epc_business_id = nullif(auth.jwt() ->> 'business_id', '')::uuid
     and a.status <> 'rejected' and a.aborted_at is null
     and epc_member_role() in ('OWNER', 'ADMIN', 'VIEWER', 'SALES')
$$;
revoke all on function epc_project_lender(uuid) from public;
grant execute on function epc_project_lender(uuid) to authenticated;

-- ── 2b. The dashboard (0130, as before except the lender money + customer_apps) ──
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
         -- The lender's money: its tranches, or the "From lender" payments the EPC
         -- typed in if those are more — never both (the same money).
         coalesce(pay.cust, 0) + greatest(coalesce(pay.lend, 0), coalesce(lp.paid, 0)) as received,
         coalesce(pay.cust, 0) as customer_received,
         greatest(coalesce(f.project_cost, 0) - coalesce(pay.cust, 0) - greatest(coalesce(pay.lend, 0), coalesce(lp.paid, 0)), 0) as balance,
         -- What the customer still owes: the lender's share (net of its charges) is the lender's.
         greatest(coalesce(f.project_cost, 0) - coalesce(pay.cust, 0) - greatest(coalesce(pay.lend, 0), coalesce(lp.share, 0)), 0) as customer_balance,
         lp.first_amount, lp.first_date, lp.second_amount, lp.second_date,
         (p.created_at at time zone 'Asia/Kolkata')::date between ctx.d_from and ctx.d_to as in_period
    from ctx
    join epc_projects p on p.business_id = ctx.biz
    left join epc_project_finance f on f.project_id = p.id
    left join (select x.project_id,
                      sum(x.amount) filter (where x.source = 'customer') as cust,
                      sum(x.amount) filter (where x.source = 'lender') as lend
                 from epc_project_payments x, ctx
                where x.business_id = ctx.biz
                group by x.project_id) pay on pay.project_id = p.id
    left join lateral (select * from epc_project_lender(p.application_id) where p.payment_mode <> 'cash') lp on true
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
             pr.customer_balance, extract(epoch from pr.payment_due_on::timestamp)
        from pr, ctx
       where pr.payment_due_on < ctx.today and pr.customer_balance > 0
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
      'received',      (select coalesce(sum(coalesce(pp.cust, 0) + greatest(coalesce(pp.lend, 0),
                                  case when q.first_date between c.d_from and c.d_to then coalesce(q.first_amount, 0) else 0 end
                                + case when q.second_date between c.d_from and c.d_to then coalesce(q.second_amount, 0) else 0 end)), 0)
                          from ctx c
                          cross join pr q
                          left join (select x.project_id,
                                            sum(x.amount) filter (where x.source = 'customer') as cust,
                                            sum(x.amount) filter (where x.source = 'lender') as lend
                                       from epc_project_payments x, ctx c2
                                      where x.business_id = c2.biz and x.paid_on between c2.d_from and c2.d_to
                                      group by x.project_id) pp on pp.project_id = q.id),
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
                                        'received', t.customer_received, 'balance', t.customer_balance, 'due_on', t.payment_due_on)
                     order by t.payment_due_on desc nulls last, t.created_at desc)
      from (select * from pr where pr.customer_balance > 0
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
  -- Customer applications (0102 — the gozerobils builder, Sustera): quotations made,
  -- PCRs and agreements, each counted (and its price summed) on its own date in the period.
  'customer_apps', (
    select jsonb_build_object(
      'quotations',       count(*) filter (where c.made_on between ctx.d_from and ctx.d_to),
      'quotations_value', coalesce(sum(c.price) filter (where c.made_on between ctx.d_from and ctx.d_to), 0),
      'pcr',              count(*) filter (where c.pcr_on between ctx.d_from and ctx.d_to),
      'pcr_value',        coalesce(sum(c.price) filter (where c.pcr_on between ctx.d_from and ctx.d_to), 0),
      'agreements',       count(*) filter (where c.agreement_on between ctx.d_from and ctx.d_to),
      'agreements_value', coalesce(sum(c.price) filter (where c.agreement_on between ctx.d_from and ctx.d_to), 0))
      from ctx
      join (select q.epc_business_id,
                   (q.created_at at time zone 'Asia/Kolkata')::date as made_on,
                   (q.pcr_at at time zone 'Asia/Kolkata')::date as pcr_on,
                   (q.agreement_at at time zone 'Asia/Kolkata')::date as agreement_on,
                   -- the form's price, digits only ("1,75,000" → 175000); anything else counts 0
                   case when regexp_replace(coalesce(q.data ->> 'price', ''), '[^0-9.]', '', 'g') ~ '^[0-9]+(\.[0-9]+)?$'
                        then regexp_replace(q.data ->> 'price', '[^0-9.]', '', 'g')::numeric end as price
              from customer_quotations q) c on c.epc_business_id = ctx.biz),
  'insurance_due', coalesce((
    select jsonb_agg(jsonb_build_object('id', ins.id, 'name', ins.name, 'policy_to_date', ins.policy_to_date, 'days_left', ins.days_left)
                     order by ins.policy_to_date)
      from ins), '[]'::jsonb)
);
$$;

revoke all on function public.epc_dashboard(date, date) from public;
grant execute on function public.epc_dashboard(date, date) to authenticated;

-- ── 3. Customer applications: the Quotations module, no Site staff (as 0120's epc_quotes) ──
-- No admin access, as before (CC's role is 'CC'). There is no per-person owner on
-- these rows, so Sales see the company's customer applications.
drop policy if exists customer_quotations_own_read on public.customer_quotations;
create policy customer_quotations_own_read on public.customer_quotations for select
  using (epc_business_id = (nullif(auth.jwt() ->> 'business_id', ''))::uuid and (select epc_has_module('quotes'))
         and (select epc_member_role()) in ('OWNER', 'ADMIN', 'VIEWER', 'SALES'));
drop policy if exists customer_quotations_own_insert on public.customer_quotations;
create policy customer_quotations_own_insert on public.customer_quotations for insert
  with check (epc_business_id = (nullif(auth.jwt() ->> 'business_id', ''))::uuid and (select epc_has_module('quotes'))
              and (select epc_member_role()) in ('OWNER', 'ADMIN', 'SALES'));
drop policy if exists customer_quotations_own_update on public.customer_quotations;
create policy customer_quotations_own_update on public.customer_quotations for update
  using (epc_business_id = (nullif(auth.jwt() ->> 'business_id', ''))::uuid and (select epc_has_module('quotes'))
         and (select epc_member_role()) in ('OWNER', 'ADMIN', 'SALES'))
  with check (epc_business_id = (nullif(auth.jwt() ->> 'business_id', ''))::uuid);
