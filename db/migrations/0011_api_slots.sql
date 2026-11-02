-- Felles tempo mot eksterne API-er med strenge grenser (f.eks. Doffins nedlasting: 10 kall per minutt
-- per abonnement). Hver prosess som skal gjøre et kall, reserverer neste ledige «luke» atomisk her,
-- slik at webapp, arbeider og kommandolinjeverktøy til sammen aldri går over grensen – også etter
-- omstart. Etter HTTP 429 flyttes neste luke til tidspunktet i Retry-After.
create table if not exists api_slots (
  key text primary key check (char_length(key) between 1 and 100),
  next_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- Brukes bare av eier-rollen (bakgrunnsjobber og kommandolinje). Ingen tilgang for webapp-rollen.
alter table api_slots enable row level security;
