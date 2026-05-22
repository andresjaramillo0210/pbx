-- pbxscape v1 schema: pickleball tournament management
-- Conventions: admins write everything (Supabase auth users); public read for published tournaments.

create extension if not exists "pgcrypto";

-- ENUMS ----------------------------------------------------------------------

create type division_type as enum ('singles', 'doubles', 'mixed_doubles');
create type division_level as enum ('beginner', 'intermediate', 'advanced');
create type division_gender as enum ('mens', 'womens');
create type tournament_status as enum ('draft', 'published', 'in_progress', 'completed', 'archived');
create type division_format as enum ('round_robin', 'pool_to_bracket', 'single_elimination');
create type match_stage as enum ('round_robin', 'pool', 'bracket');
create type match_status as enum ('pending', 'scheduled', 'in_progress', 'reported', 'voided', 'forfeit');

-- CORE TABLES ---------------------------------------------------------------

create table tournaments (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  starts_on     date,
  ends_on       date,
  status        tournament_status not null default 'draft',
  created_by    uuid references auth.users(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

-- Courts are venue-level (single venue: Westminster Pickleball Xscape).
-- Managed once via the admin Courts screen; tournaments share the same pool.
create table courts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  stream_url    text,
  display_order int  not null default 0,
  archived_at   timestamptz
);

create table divisions (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  type          division_type not null,
  level         division_level not null,
  -- Required for singles/doubles; null for mixed_doubles (mixed is its own
  -- gender category in pickleball convention).
  gender        division_gender,
  -- Format is picked AFTER registration closes, based on actual team count.
  -- Null while registration is open.
  format        division_format,
  best_of       int  not null default 1 check (best_of in (1, 3, 5)),
  game_to       int  not null default 11 check (game_to between 7 and 25),
  win_by        int  not null default 2  check (win_by  between 1 and 5),
  num_pools     int  default null check (num_pools is null or num_pools between 1 and 16),
  teams_advance int  default null check (teams_advance is null or teams_advance between 1 and 8),
  check (win_by < game_to),
  -- Gender required iff type is singles or doubles. Mixed = no gender field.
  check ((type = 'mixed_doubles' and gender is null) or (type <> 'mixed_doubles' and gender is not null)),
  tiebreaker_config jsonb not null default
    '{"cascade": ["head_to_head", "point_diff", "points_for", "coin_flip"]}'::jsonb,
  -- When true, the public viewer shows PF / PA / PD columns in standings.
  -- Default on; admin flips OFF for beginner divisions where point details
  -- might discourage casual players.
  show_points_details boolean not null default true,
  -- open: taking registrations. locked: matches generated. running: in play. complete: done.
  status        text not null default 'open',
  unique (tournament_id, type, level, gender)
);

create table players (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  full_name     text not null,
  contact       text  -- email or phone, freeform for now
);

create table teams (
  id            uuid primary key default gen_random_uuid(),
  division_id   uuid not null references divisions(id) on delete cascade,
  name          text not null,
  seed          int,
  withdrawn_at  timestamptz
);

-- Case-insensitive uniqueness on trimmed team names within a division.
create unique index teams_division_name_uniq
  on teams (division_id, lower(btrim(name)));

create table team_players (
  team_id   uuid not null references teams(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  primary key (team_id, player_id)
);

-- Pools (only used when division.format = 'pool_to_bracket')
create table pools (
  id           uuid primary key default gen_random_uuid(),
  division_id  uuid not null references divisions(id) on delete cascade,
  name         text not null,                  -- "Pool A", "Pool B"
  unique (division_id, name)
);

create table pool_teams (
  pool_id uuid not null references pools(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  primary key (pool_id, team_id)
);

-- Which physical courts a division is allowed to use. Match generation
-- assigns court_id to matches in rotation across this set.
create table division_courts (
  division_id   uuid not null references divisions(id) on delete cascade,
  court_id      uuid not null references courts(id) on delete restrict,
  display_order int  not null default 0,
  primary key (division_id, court_id)
);

-- MATCHES -------------------------------------------------------------------

create table matches (
  id              uuid primary key default gen_random_uuid(),
  division_id     uuid not null references divisions(id) on delete cascade,
  stage           match_stage not null,
  pool_id         uuid references pools(id) on delete set null,
  round_number    int,                          -- round-robin rotation round (circle method)
  bracket_round   int,                          -- bracket round (1 = first), increasing toward final
  bracket_slot    int,                          -- position within bracket round
  team_a_id       uuid references teams(id) on delete set null,
  team_b_id       uuid references teams(id) on delete set null,
  court_id        uuid references courts(id) on delete set null,
  scheduled_at    timestamptz,
  started_at      timestamptz,
  ended_at        timestamptz,
  status          match_status not null default 'pending',
  winner_team_id  uuid references teams(id) on delete set null,
  -- Bracket plumbing: pointer to the match that consumes this winner.
  next_match_id   uuid references matches(id) on delete set null,
  next_match_slot text check (next_match_slot in ('a', 'b'))
);

create index matches_division_idx on matches (division_id);
create index matches_court_active_idx
  on matches (court_id)
  where status in ('scheduled', 'in_progress');

create table match_games (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references matches(id) on delete cascade,
  game_number   int  not null,
  score_a       int  not null,
  score_b       int  not null,
  unique (match_id, game_number),
  check (score_a >= 0 and score_b >= 0)
);

-- Versioned audit log of every score entry so we can undo / show history.
create table score_events (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references matches(id) on delete cascade,
  entered_by    uuid references auth.users(id),
  entered_at    timestamptz not null default now(),
  payload       jsonb not null,                 -- {games:[{n,a,b}], winner, forfeit?}
  superseded_by uuid references score_events(id) on delete set null,
  note          text
);

create index score_events_match_idx on score_events (match_id, entered_at desc);

-- RLS -----------------------------------------------------------------------
-- v1 rule: any authenticated user is treated as an admin (single role).
-- Public (anon) can read published tournaments and their children.
-- Tighten this once we have multi-tenant orgs.

alter table tournaments    enable row level security;
alter table courts         enable row level security;
alter table divisions      enable row level security;
alter table players        enable row level security;
alter table teams          enable row level security;
alter table team_players   enable row level security;
alter table pools          enable row level security;
alter table pool_teams     enable row level security;
alter table division_courts enable row level security;
alter table matches        enable row level security;
alter table match_games    enable row level security;
alter table score_events   enable row level security;

-- Public read for non-draft tournaments and their children.
create policy "public read tournaments"
  on tournaments for select
  using (status <> 'draft');

-- Courts are a global venue resource; anyone can read the active list.
create policy "public read courts"
  on courts for select
  using (archived_at is null);

create policy "public read divisions"
  on divisions for select
  using (exists (select 1 from tournaments t where t.id = divisions.tournament_id and t.status <> 'draft'));

create policy "public read teams"
  on teams for select
  using (exists (
    select 1 from divisions d join tournaments t on t.id = d.tournament_id
    where d.id = teams.division_id and t.status <> 'draft'));

create policy "public read players"
  on players for select
  using (exists (select 1 from tournaments t where t.id = players.tournament_id and t.status <> 'draft'));

create policy "public read team_players"
  on team_players for select
  using (exists (
    select 1 from teams tm join divisions d on d.id = tm.division_id
    join tournaments t on t.id = d.tournament_id
    where tm.id = team_players.team_id and t.status <> 'draft'));

create policy "public read pools"
  on pools for select
  using (exists (
    select 1 from divisions d join tournaments t on t.id = d.tournament_id
    where d.id = pools.division_id and t.status <> 'draft'));

create policy "public read pool_teams"
  on pool_teams for select
  using (exists (
    select 1 from pools p join divisions d on d.id = p.division_id
    join tournaments t on t.id = d.tournament_id
    where p.id = pool_teams.pool_id and t.status <> 'draft'));

create policy "public read matches"
  on matches for select
  using (exists (
    select 1 from divisions d join tournaments t on t.id = d.tournament_id
    where d.id = matches.division_id and t.status <> 'draft'));

create policy "public read match_games"
  on match_games for select
  using (exists (
    select 1 from matches m join divisions d on d.id = m.division_id
    join tournaments t on t.id = d.tournament_id
    where m.id = match_games.match_id and t.status <> 'draft'));

-- Admin write: any authenticated user can mutate everything (v1).
create policy "admin all tournaments"  on tournaments  for all to authenticated using (true) with check (true);
create policy "admin all courts"       on courts       for all to authenticated using (true) with check (true);
create policy "admin all divisions"    on divisions    for all to authenticated using (true) with check (true);
create policy "admin all players"      on players      for all to authenticated using (true) with check (true);
create policy "admin all teams"        on teams        for all to authenticated using (true) with check (true);
create policy "admin all team_players" on team_players for all to authenticated using (true) with check (true);
create policy "admin all pools"        on pools        for all to authenticated using (true) with check (true);
create policy "admin all pool_teams"   on pool_teams   for all to authenticated using (true) with check (true);
create policy "admin all division_courts" on division_courts for all to authenticated using (true) with check (true);
create policy "public read division_courts"
  on division_courts for select
  using (exists (
    select 1 from divisions d join tournaments t on t.id = d.tournament_id
    where d.id = division_courts.division_id and t.status <> 'draft'));
create policy "admin all matches"      on matches      for all to authenticated using (true) with check (true);
create policy "admin all match_games"  on match_games  for all to authenticated using (true) with check (true);
create policy "admin all score_events" on score_events for all to authenticated using (true) with check (true);

-- TRIGGERS ------------------------------------------------------------------

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger tournaments_updated_at
  before update on tournaments
  for each row execute function set_updated_at();

-- Free-court detector: a court is "occupied" if any match referencing it
-- has status in ('scheduled', 'in_progress'). Surfaced as a view.
create view free_courts_v as
select c.id as court_id, c.name
from courts c
where c.archived_at is null
  and not exists (
    select 1 from matches m
    where m.court_id = c.id
      and m.status in ('scheduled', 'in_progress')
  );

-- GRANTS --------------------------------------------------------------------
-- Re-grant table-level access to the anon and authenticated roles. Needed
-- after a fresh `drop schema public cascade`, which strips the defaults that
-- Supabase sets up at project init. RLS policies above remain the real gate.

grant usage on schema public to anon, authenticated;
grant all on all tables     in schema public to anon, authenticated;
grant all on all sequences  in schema public to anon, authenticated;
grant all on all routines   in schema public to anon, authenticated;

alter default privileges in schema public grant all on tables    to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on routines  to anon, authenticated;

-- SEED ----------------------------------------------------------------------
-- Westminster Pickleball Xscape has 11 courts. Pre-create them so admins
-- don't have to. They can archive any they don't want or stream-tag them.

insert into courts (name, display_order) values
  ('Court 1',  1),
  ('Court 2',  2),
  ('Court 3',  3),
  ('Court 4',  4),
  ('Court 5',  5),
  ('Court 6',  6),
  ('Court 7',  7),
  ('Court 8',  8),
  ('Court 9',  9),
  ('Court 10', 10),
  ('Court 11', 11);
