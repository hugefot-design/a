-- Vekst: besøkstelling uten personopplysninger, og gratis ukesbrev («Ukens anbud») uten konto.
-- Bare eier-rollen (systemSql) leser og skriver; webapp-rollen har ingen rettigheter til tabellene.

-- 1. Sidevisninger per dag, side og kilde (Google, LinkedIn, direkte …).
--    Ingen IP-adresse, ingen informasjonskapsler, ingen nettleserdata – bare tellere.
--    Innloggede brukere og roboter telles ikke.
create table if not exists page_views_daily (
  day date not null,
  path text not null check (char_length(path) <= 200),
  source text not null check (char_length(source) <= 60),
  views integer not null default 0,
  primary key (day, path, source)
);
alter table page_views_daily enable row level security;

-- 2. Ukesbrev uten konto. Dobbel bekreftelse (samtykket lagres med tidspunkt og versjon).
--    Ved avmelding slettes raden; ubekreftede påmeldinger slettes etter 7 dager.
create table if not exists newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email citext not null check (char_length(email) <= 254),
  industry text not null check (char_length(industry) <= 40),
  region text check (region is null or char_length(region) <= 4),
  consent_version text not null default 'ukesbrev-v1',
  source_path text check (source_path is null or char_length(source_path) <= 200),
  confirmed_at timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists newsletter_subscribers_uq on newsletter_subscribers (email, industry, coalesce(region, ''));
create index if not exists newsletter_subscribers_confirmed_idx on newsletter_subscribers (confirmed_at) where confirmed_at is not null;
alter table newsletter_subscribers enable row level security;
