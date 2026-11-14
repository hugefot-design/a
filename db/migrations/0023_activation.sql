-- Aktivering og måling uten tredjepart og uten informasjonskapsler.
-- Brukes til «Kom i gang» på Oversikt og til Admin → Kundereise (hvor kundene faller fra, og hvem som blir).
-- Bare eier-rollen (systemSql) leser og skriver; webapp-rollen har ingen rettigheter til de to nye tabellene.
-- Ingen eksisterende data endres.

-- 1. Første gang en organisasjon bruker en funksjon (åpner et anbud, ser samlet vurdering, åpner lønnsomhet,
--    laster ned PDF). Én rad per organisasjon og funksjon – ingen logg over hver visning.
create table if not exists feature_first_use (
  org_id uuid not null references organizations(id) on delete cascade,
  feature text not null check (char_length(feature) <= 40),
  user_id uuid references users(id) on delete set null,
  first_at timestamptz not null default now(),
  primary key (org_id, feature)
);
alter table feature_first_use enable row level security;

-- 2. Dager en bruker har vært inne i appen (én rad per bruker per dag, norsk tid). Gir «aktiv etter 7 og 30 dager».
--    Ingen sider, ingen klokkeslett, ingen IP-adresser. Slettes etter 13 måneder.
create table if not exists user_active_days (
  user_id uuid not null references users(id) on delete cascade,
  day date not null,
  primary key (user_id, day)
);
create index if not exists user_active_days_day_idx on user_active_days (day);
alter table user_active_days enable row level security;

-- 3. Hvor registreringen kom fra: siden kunden sto på (f.eks. /demo eller /bransjer/renhold) og kilden
--    (google, linkedin, ukesbrev …). Settes ved registrering, uten informasjonskapsler.
alter table users add column if not exists signup_path text check (signup_path is null or char_length(signup_path) <= 200);
alter table users add column if not exists signup_source text check (signup_source is null or char_length(signup_source) <= 60);
