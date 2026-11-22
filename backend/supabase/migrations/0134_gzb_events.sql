-- 0134 — gzb_events: every visit to gozerobils.com, and what the visitor did.
--
-- One row per event. The website keeps events in the browser and sends them in
-- small batches to gozerobils.com/api/events (a Cloudflare Worker), which calls
-- gzb_save_events() below with the same secret key the leads API uses
-- (gozerobils_api_keys, migration 0123). Nobody can insert any other way.
--
--   visitor_id  one browser. Random, kept in the browser (storage + cookie), so
--               a visitor who comes back weeks later has the same id.
--   visit_id    one visit of that browser (a new one after 30 quiet minutes).
--   visit_no    1 for the first visit of that browser, 2 for the next, ...
--   type        visit_start · page_view · scroll · engage · click · dead_tap ·
--               rage_tap · form · pixel · capi · page_end · error
--   name        depends on the type: the scroll depth, the Meta event name, the
--               form step, ...
--   data        small extra details (never what a visitor typed).
--
-- A lead is tied to its visitor by the row type='form', name='lead_saved':
-- data->>'sid' is gozerobils_leads.submission_id.
--
-- Meta events: type='pixel' = fired in the browser (data.id = the event id);
-- type='capi' = the server copy and Meta's answer (data.ok = 1 accepted, 0 not).
-- The same data.id in both = both sides were triggered for that event.
--
-- Rows older than 90 days are deleted every night (gzb_purge_events, pg_cron — at
-- the end of this file; the 90 is written once, in the job's command).
--
-- rollback: select cron.unschedule(jobid) from cron.job where jobname = 'gzb-purge-events';
--           drop function if exists gzb_purge_events(integer);
--           drop function if exists gzb_traffic_visits(date);
--           drop function if exists gzb_traffic_days(integer);
--           drop function if exists gzb_save_events(text, jsonb);
--           drop table if exists gzb_events;

create table if not exists gzb_events (
  id          bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  eid         text not null unique,            -- made by the sender: a batch sent twice is stored once
  src         text not null default 'web' check (src in ('web','server')),
  visitor_id  text not null,
  visit_id    text not null,
  visit_no    integer,
  seq         integer,                         -- order inside the visit
  at          timestamptz,                     -- the visitor's own clock
  type        text not null,
  name        text,
  page        text,
  data        jsonb
);

create index if not exists gzb_events_received_idx on gzb_events (received_at desc);
create index if not exists gzb_events_visit_idx    on gzb_events (visit_id, seq);
create index if not exists gzb_events_visitor_idx  on gzb_events (visitor_id);

alter table gzb_events enable row level security;

-- Read-only for admins. Rows are written only by gzb_save_events().
drop policy if exists gzb_events_admin_read on gzb_events;
create policy gzb_events_admin_read on gzb_events
  for select to authenticated
  using (auth.jwt() ->> 'business_type' = 'admin');

-- Save one batch (at most 200 events). Answers {ok, saved} or {ok:false, error}.
create or replace function gzb_save_events(p_key text, p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saved integer := 0;
begin
  if coalesce(p_key, '') = '' or not exists (
    select 1 from gozerobils_api_keys
    where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
      and revoked_at is null
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_key');
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'events_must_be_a_list');
  end if;

  insert into gzb_events (eid, src, visitor_id, visit_id, visit_no, seq, at, type, name, page, data)
  select
    left(e ->> 'eid', 80),
    case when e ->> 'src' = 'server' then 'server' else 'web' end,
    left(e ->> 'visitor_id', 80),
    left(e ->> 'visit_id', 80),
    case when e ->> 'visit_no' ~ '^[0-9]{1,6}$' then (e ->> 'visit_no')::integer end,
    case when e ->> 'seq'      ~ '^[0-9]{1,7}$' then (e ->> 'seq')::integer end,
    case when e ->> 't' ~ '^[0-9]{12,14}$' then to_timestamp((e ->> 't')::bigint / 1000.0) end,
    left(e ->> 'type', 20),
    nullif(left(e ->> 'name', 120), ''),
    nullif(left(e ->> 'page', 200), ''),
    case when jsonb_typeof(e -> 'data') = 'object' and length((e -> 'data')::text) <= 2000 then e -> 'data' end
  from jsonb_array_elements(p_events) with ordinality as t(e, i)
  where i <= 200
    and jsonb_typeof(e) = 'object'
    and coalesce(e ->> 'eid', '') <> ''
    and coalesce(e ->> 'visitor_id', '') <> ''
    and coalesce(e ->> 'visit_id', '') <> ''
    and coalesce(e ->> 'type', '') <> ''
  on conflict (eid) do nothing;

  get diagnostics v_saved = row_count;
  return jsonb_build_object('ok', true, 'saved', v_saved);
end $$;

revoke all on function gzb_save_events(text, jsonb) from public;
grant execute on function gzb_save_events(text, jsonb) to anon, authenticated;

-- ── Reading it back (admins only: these run as the caller, so the read policy applies) ──

-- One line per day (India time), newest first: did traffic come, and were the Meta events triggered.
create or replace function gzb_traffic_days(p_days integer default 14)
returns table (
  day date, visitors bigint, new_visitors bigint, visits bigint, page_views bigint,
  clicks bigint, dead_taps bigint, rage_taps bigint, form_starts bigint, leads bigint,
  pixel_events bigint, pixel_blocked bigint, capi_ok bigint, capi_failed bigint, errors bigint
)
language sql
stable
set search_path = public
as $$
  select
    (received_at at time zone 'Asia/Kolkata')::date,
    count(distinct visitor_id) filter (where src = 'web'),
    count(*) filter (where type = 'visit_start' and visit_no = 1),
    count(distinct visit_id) filter (where src = 'web'),
    count(*) filter (where type = 'page_view'),
    count(*) filter (where type = 'click'),
    count(*) filter (where type = 'dead_tap'),
    count(*) filter (where type = 'rage_tap'),
    count(*) filter (where type = 'pixel' and name = 'FormStart'),
    count(*) filter (where type = 'form' and name = 'lead_saved'),
    count(*) filter (where type = 'pixel' and name <> '_library'),
    count(*) filter (where type = 'pixel' and name = '_library' and data ->> 'ok' = '0'),
    count(*) filter (where type = 'capi' and data ->> 'ok' = '1'),
    count(*) filter (where type = 'capi' and data ->> 'ok' = '0'),
    count(*) filter (where type = 'error')
  from gzb_events
  where received_at >= ((now() at time zone 'Asia/Kolkata')::date - (greatest(least(coalesce(p_days, 14), 90), 1) - 1))::timestamp at time zone 'Asia/Kolkata'
  group by 1
  order by 1 desc;
$$;

-- One line per visit of one day (India time), newest first: what each visitor did.
create or replace function gzb_traffic_visits(p_day date default null)
returns table (
  visit_id text, visitor_id text, visit_no integer, started timestamptz,
  source text, campaign text, referrer text, landing text, device text,
  pages bigint, max_scroll integer, engaged_seconds integer,
  clicks bigint, dead_taps bigint, rage_taps bigint,
  pixel_events text, capi_ok text, capi_failed text, lead boolean
)
language sql
stable
set search_path = public
as $$
  select
    e.visit_id,
    min(e.visitor_id),
    max(e.visit_no),
    min(e.received_at),
    max(e.data ->> 'utm_source')   filter (where e.type = 'visit_start'),
    max(e.data ->> 'utm_campaign') filter (where e.type = 'visit_start'),
    max(e.data ->> 'ref')          filter (where e.type = 'visit_start'),
    max(e.data ->> 'land')         filter (where e.type = 'visit_start'),
    max(e.data ->> 'dev')          filter (where e.type = 'visit_start'),
    count(*) filter (where e.type = 'page_view'),
    max(case when e.type = 'scroll' and e.name ~ '^[0-9]{1,3}$' then e.name::integer end),
    max(case when e.type = 'engage' and e.name ~ '^[0-9]{1,5}$' then e.name::integer end),
    count(*) filter (where e.type = 'click'),
    count(*) filter (where e.type = 'dead_tap'),
    count(*) filter (where e.type = 'rage_tap'),
    string_agg(distinct e.name, ', ') filter (where e.type = 'pixel' and e.name <> '_library'),
    string_agg(distinct e.name, ', ') filter (where e.type = 'capi' and e.data ->> 'ok' = '1'),
    string_agg(distinct e.name, ', ') filter (where e.type = 'capi' and e.data ->> 'ok' = '0'),
    bool_or(e.type = 'form' and e.name = 'lead_saved')
  from gzb_events e
  where e.received_at >= coalesce(p_day, (now() at time zone 'Asia/Kolkata')::date)::timestamp at time zone 'Asia/Kolkata'
    and e.received_at <  (coalesce(p_day, (now() at time zone 'Asia/Kolkata')::date) + 1)::timestamp at time zone 'Asia/Kolkata'
    and e.visit_id <> 'server'
  group by e.visit_id
  order by min(e.received_at) desc
  limit 300;
$$;

revoke all on function gzb_traffic_days(integer) from public, anon;
revoke all on function gzb_traffic_visits(date) from public, anon;
grant execute on function gzb_traffic_days(integer) to authenticated;
grant execute on function gzb_traffic_visits(date) to authenticated;

-- ── Clean-up: rows older than p_keep_days days are deleted (every night, below) ──
create or replace function gzb_purge_events(p_keep_days integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if p_keep_days is null or p_keep_days < 7 then
    raise exception 'gzb_purge_events: keep at least 7 days (got %)', p_keep_days;
  end if;
  delete from gzb_events where received_at < now() - make_interval(days => p_keep_days);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function gzb_purge_events(integer) from public, anon, authenticated;

-- Daily at 03:15 India time (21:45 UTC), after the dead-lead clean-up (0101).
-- The 90 is the number of days kept: to change it, run these two lines again with the new number.
select cron.unschedule(jobid) from cron.job where jobname = 'gzb-purge-events';
select cron.schedule('gzb-purge-events', '45 21 * * *', 'select public.gzb_purge_events(90)');
