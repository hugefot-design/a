-- Gratisplanen og Future Opportunities. Bare tillegg – ingenting slettes eller endres i eksisterende data.

-- ---------------------------------------------------------------------------
-- 1. Prøveperioden gis bare én gang per bruker (før kunne man få ny prøveperiode
--    ved å opprette en ny organisasjon). Eksisterende brukere som har opprettet en
--    organisasjon, regnes som å ha brukt prøveperioden.
-- ---------------------------------------------------------------------------
alter table users add column if not exists trial_started_at timestamptz;
update users u set trial_started_at = o.first_created
from (select created_by, min(created_at) as first_created from organizations where created_by is not null group by created_by) o
where o.created_by = u.id and u.trial_started_at is null;
grant update (trial_started_at) on users to anbudradar_app;

-- ---------------------------------------------------------------------------
-- 2. Gratisgrensen for søk: én rad per distinkte søk per organisasjon og dag (norsk tid).
--    Bare systemrollen leser og skriver (grensen sjekkes på serveren).
-- ---------------------------------------------------------------------------
create table if not exists search_usage (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  day date not null,
  query_hash text not null check (char_length(query_hash) between 1 and 64),
  created_at timestamptz not null default now(),
  primary key (org_id, day, query_hash)
);
create index if not exists search_usage_user_day_idx on search_usage (user_id, day);
alter table search_usage enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Future Opportunities: signaler om fremtidige prosjekter fra andre offisielle kilder enn
--    kunngjøringer (først eInnsyn: politiske møtesaker og saksmapper). Offentlige data.
--    Landkode og kilde gjør at flere land kan legges til senere.
-- ---------------------------------------------------------------------------
create table if not exists opportunity_sources (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  country_code char(2) not null references countries(code),
  name text not null,
  description text not null,
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table opportunity_sources enable row level security;
grant select on opportunity_sources to anbudradar_app;
create policy public_read on opportunity_sources for select to anbudradar_app using (true);
insert into opportunity_sources (id, country_code, name, description) values
  ('einnsyn', 'NO', 'eInnsyn', 'Politiske møtesaker og saksmapper fra kommuner, fylker og statlige virksomheter (Digdir).')
on conflict (id) do nothing;

create table if not exists opportunity_signals (
  id uuid primary key default gen_random_uuid(),
  source text not null references opportunity_sources(id),
  source_ref text not null check (char_length(source_ref) between 1 and 200),
  country_code char(2) not null references countries(code),
  kind text not null check (kind in ('political_case', 'case_file')),
  title text not null check (char_length(title) between 1 and 1000),
  publisher text check (char_length(publisher) <= 300),
  publisher_org_numbers text[] not null default '{}',
  region_codes text[] not null default '{}',
  industry_ids text[] not null default '{}',
  matched_terms text[] not null default '{}',
  published_at timestamptz,
  url text not null check (url ~ '^https://'),
  first_seen_at timestamptz not null default now(),
  unique (source, source_ref)
);
create index if not exists opportunity_signals_published_idx on opportunity_signals (published_at desc);
create index if not exists opportunity_signals_regions_idx on opportunity_signals using gin (region_codes);
create index if not exists opportunity_signals_industries_idx on opportunity_signals using gin (industry_ids);
alter table opportunity_signals enable row level security;
grant select on opportunity_signals to anbudradar_app;
create policy public_read on opportunity_signals for select to anbudradar_app using (true);

-- Mellomlager for organ (journalenhet) i eInnsyn: navn, org.nr. og fylke via kommunenummer.
create table if not exists einnsyn_units (
  id text primary key check (char_length(id) <= 100),
  name text not null,
  org_number text,
  kommunenummer text,
  parent_id text,
  fetched_at timestamptz not null default now()
);
alter table einnsyn_units enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Prosjekter en organisasjon følger (en planlagt kunngjøring eller et signal).
-- ---------------------------------------------------------------------------
create table if not exists opportunity_follows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  tender_id uuid references tenders(id) on delete cascade,
  signal_id uuid references opportunity_signals(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((tender_id is null) <> (signal_id is null))
);
create unique index if not exists opportunity_follows_tender_uq on opportunity_follows (org_id, tender_id) where tender_id is not null;
create unique index if not exists opportunity_follows_signal_uq on opportunity_follows (org_id, signal_id) where signal_id is not null;
alter table opportunity_follows enable row level security;
grant select, insert, delete on opportunity_follows to anbudradar_app;
create policy tenant_read on opportunity_follows for select to anbudradar_app using (org_id = app_current_org_id());
create policy tenant_insert on opportunity_follows for insert to anbudradar_app with check (org_id = app_current_org_id());
create policy tenant_delete on opportunity_follows for delete to anbudradar_app using (org_id = app_current_org_id());

-- Ny varseltype for Future Opportunities.
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in (
  'new_match', 'saved_search', 'deadline', 'tender_update', 'cancellation',
  'weekly_summary', 'payment_failed', 'competitor_award', 'system', 'partner_request', 'partner_response',
  'opportunity'));
