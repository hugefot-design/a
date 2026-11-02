-- Automatisk berikelse av Doffin-søketreff med full eForms-XML (src/connectors/doffin-enrich.ts).
-- Én rad per Doffin-ID som er forsøkt: resultat, antall forsøk og når den tidligst kan prøves igjen.
-- Inneholder ingen persondata. Bare systemrollen bruker tabellen (RLS på, ingen policyer for appen).
create table doffin_enrichment (
  doffin_id text primary key check (doffin_id ~ '^[0-9]{4}-[0-9]{1,12}$'),
  status text not null check (status in ('ok', 'retry', 'gave_up')),
  attempts int not null default 0 check (attempts >= 0),
  last_outcome text not null check (char_length(last_outcome) <= 40),
  last_message text check (char_length(last_message) <= 500),
  last_attempt_at timestamptz not null default now(),
  next_attempt_at timestamptz,
  check (status <> 'retry' or next_attempt_at is not null)
);
create index doffin_enrichment_retry_idx on doffin_enrichment (next_attempt_at) where status = 'retry';
alter table doffin_enrichment enable row level security;
