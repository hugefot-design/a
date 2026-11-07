-- Feilovervåking i appen (gratis, ingen ny leverandør): feil som logges på nivå «error» samles her,
-- gruppert per feiltype, og administratoren får en oppsummering på e-post. Personopplysninger fjernes
-- før lagring (e-post, lange tall, nøkler). Ingen bruker- eller organisasjons-ID lagres.
-- Bare eier-rollen (systemSql) leser og skriver; webapp-rollen har ingen rettigheter til tabellen.
create table if not exists app_errors (
  fingerprint text primary key check (char_length(fingerprint) <= 64),
  source text not null check (char_length(source) <= 80),
  name text not null check (char_length(name) <= 120),
  message text not null check (char_length(message) <= 500),
  location text check (location is null or char_length(location) <= 200),
  context text check (context is null or char_length(context) <= 200),
  stack text check (stack is null or char_length(stack) <= 2000),
  count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  notified_at timestamptz,
  resolved_at timestamptz
);
create index if not exists app_errors_open_idx on app_errors (last_seen_at desc) where resolved_at is null;
alter table app_errors enable row level security;
