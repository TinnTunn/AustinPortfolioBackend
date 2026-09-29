-- Austin Portfolio API — database schema.
-- Run in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run again: everything is "if not exists" / "or replace".
--
-- Security model: every table has Row Level Security ON and NO policies, so
-- the public anon key can't read or write anything. Only the API, using the
-- service-role key on the server, can reach the data.

-- ------------------------------------------------------------ contact form
create table if not exists public.contact_messages (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  message     text not null,
  created_at  timestamptz not null default now()
);
alter table public.contact_messages enable row level security;

-- ------------------------------------------------------------ content (admin CMS)
-- *_id columns hold the Indonesian text; empty means "show the English".
create table if not exists public.experiences (
  id          uuid primary key default gen_random_uuid(),
  sort_order  integer not null default 0,
  published   boolean not null default true,
  org         text not null check (char_length(org) between 1 and 120),
  href        text check (href is null or href ~ '^https?://'),
  tags        text[] not null default '{}',
  role_en     text not null check (char_length(role_en) between 1 and 120),
  role_id     text not null default '' check (char_length(role_id) <= 120),
  period_en   text not null check (char_length(period_en) between 1 and 60),
  period_id   text not null default '' check (char_length(period_id) <= 60),
  context_en  text not null check (char_length(context_en) between 1 and 200),
  context_id  text not null default '' check (char_length(context_id) <= 200),
  points_en   text[] not null check (cardinality(points_en) between 1 and 8),
  points_id   text[] not null default '{}' check (cardinality(points_id) <= 8),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.experiences enable row level security;
create index if not exists experiences_order_idx on public.experiences (sort_order);

create table if not exists public.projects (
  id               uuid primary key default gen_random_uuid(),
  sort_order       integer not null default 0,
  published        boolean not null default true,
  name             text not null check (char_length(name) between 1 and 80),
  href             text check (href is null or href ~ '^https?://'),
  stack            text[] not null default '{}',
  role_en          text not null check (char_length(role_en) between 1 and 120),
  role_id          text not null default '' check (char_length(role_id) <= 120),
  status_en        text not null check (char_length(status_en) between 1 and 40),
  status_id        text not null default '' check (char_length(status_id) <= 40),
  summary_en       text not null check (char_length(summary_en) between 1 and 400),
  summary_id       text not null default '' check (char_length(summary_id) <= 400),
  problem_en       text not null check (char_length(problem_en) between 1 and 800),
  problem_id       text not null default '' check (char_length(problem_id) <= 800),
  solution_en      text not null check (char_length(solution_en) between 1 and 800),
  solution_id      text not null default '' check (char_length(solution_id) <= 800),
  contribution_en  text not null check (char_length(contribution_en) between 1 and 800),
  contribution_id  text not null default '' check (char_length(contribution_id) <= 800),
  lessons_en       text not null check (char_length(lessons_en) between 1 and 800),
  lessons_id       text not null default '' check (char_length(lessons_id) <= 800),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.projects enable row level security;
create index if not exists projects_order_idx on public.projects (sort_order);

-- Reorders a whole list in ONE statement, so a move can never leave the list
-- half-updated (e.g. two items sharing a position). `p_ids` is the full list
-- in its new order; position = index in the array. The table name is checked
-- against an allow-list before it's used (%I also quotes it safely).
create or replace function public.admin_reorder(p_table text, p_ids uuid[])
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_table not in ('experiences', 'projects') then
    raise exception 'admin_reorder: unknown table %', p_table;
  end if;
  execute format(
    'update public.%I as t set sort_order = o.pos, updated_at = now()
       from unnest($1) with ordinality as o(id, pos)
      where t.id = o.id and t.sort_order is distinct from o.pos',
    p_table
  ) using p_ids;
end;
$$;
revoke all on function public.admin_reorder(text, uuid[]) from public, anon, authenticated;
grant execute on function public.admin_reorder(text, uuid[]) to service_role;

-- ------------------------------------------------------------ visitor stats
-- No raw IPs: `visitor` is a daily-rotating HMAC of (day, IP, user agent).
create table if not exists public.page_views (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  day         date not null,
  visitor     text not null,
  referrer    text,
  country     text,
  device      text,
  lang        text
);
alter table public.page_views enable row level security;
create index if not exists page_views_day_idx on public.page_views (day);

-- ------------------------------------------------------------ admin login limiter
create table if not exists public.admin_login_attempts (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  ip_hash     text not null,
  success     boolean not null
);
alter table public.admin_login_attempts enable row level security;
create index if not exists admin_login_attempts_idx on public.admin_login_attempts (created_at, ip_hash);

-- ------------------------------------------------------------ stats for /admin
-- Unique visitors over a range are the sum of daily uniques (the visitor hash
-- rotates daily by design, so the same person on two days counts twice).
create or replace function public.admin_visit_stats(p_today date, p_days integer default 30)
returns jsonb
language sql
stable
set search_path = public
as $$
  with daily as (
    select day, count(*)::int as views, count(distinct visitor)::int as visitors
    from page_views
    group by day
  ),
  series as (
    select d::date as day
    from generate_series((p_today - (p_days - 1))::timestamp, p_today::timestamp, interval '1 day') as d
  ),
  totals as (
    select
      coalesce(sum(views) filter (where day = p_today), 0)::int          as today_views,
      coalesce(sum(visitors) filter (where day = p_today), 0)::int       as today_visitors,
      coalesce(sum(views) filter (where day > p_today - 7), 0)::int      as week_views,
      coalesce(sum(visitors) filter (where day > p_today - 7), 0)::int   as week_visitors,
      coalesce(sum(views) filter (where day > p_today - 30), 0)::int     as month_views,
      coalesce(sum(visitors) filter (where day > p_today - 30), 0)::int  as month_visitors,
      coalesce(sum(views), 0)::int                                        as all_views,
      coalesce(sum(visitors), 0)::int                                     as all_visitors
    from daily
  ),
  recent as (
    select * from page_views where day > p_today - 30
  )
  select jsonb_build_object(
    'today', jsonb_build_object('views', t.today_views, 'visitors', t.today_visitors),
    'week',  jsonb_build_object('views', t.week_views,  'visitors', t.week_visitors),
    'month', jsonb_build_object('views', t.month_views, 'visitors', t.month_visitors),
    'all',   jsonb_build_object('views', t.all_views,   'visitors', t.all_visitors),
    'daily', (
      select jsonb_agg(jsonb_build_object('day', s.day, 'views', coalesce(d.views, 0), 'visitors', coalesce(d.visitors, 0)) order by s.day)
      from series s left join daily d using (day)
    ),
    'referrers', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'count', n) order by n desc)
      from (select coalesce(referrer, 'Direct') as label, count(*)::int as n from recent group by 1 order by 2 desc limit 6) r
    ), '[]'::jsonb),
    'countries', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'count', n) order by n desc)
      from (select coalesce(country, 'Unknown') as label, count(*)::int as n from recent group by 1 order by 2 desc limit 6) c
    ), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'count', n) order by n desc)
      from (select coalesce(device, 'unknown') as label, count(*)::int as n from recent group by 1 order by 2 desc) v
    ), '[]'::jsonb)
  )
  from totals t;
$$;

-- Functions in `public` are callable through the API by default: lock this
-- one down to the service role only.
revoke all on function public.admin_visit_stats(date, integer) from public, anon, authenticated;
grant execute on function public.admin_visit_stats(date, integer) to service_role;
