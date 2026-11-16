-- Lavere driftskostnader (kostnadsgjennomgangen 16.11.2026). Bare tillegg: ingen rader endres eller slettes.
--
-- 1. AI-bruk: hva en treff i hurtigbufferen sparte (kostnaden for analysen som ble gjenbrukt), hvilken analyse det var,
--    og om et billig modellforsøk ble forkastet og kjørt på nytt med den sterkere modellen (eskalering).
alter table usage_records
  add column if not exists saved_usd numeric(12, 6) not null default 0,
  add column if not exists analysis_id uuid,
  add column if not exists escalated boolean not null default false;

-- 2. AI-analyser: bufrede tokens hos leverandøren (prompt caching) for seg, så det kan måles om bufringen virker, og
--    hvilken modell som ble prøvd først når svaret måtte lages på nytt med den sterkere modellen.
alter table ai_analyses
  add column if not exists cache_read_tokens integer not null default 0,
  add column if not exists cache_write_tokens integer not null default 0,
  add column if not exists escalated_from text;

-- 3. Én AI-forespørsel om gangen for samme innhold: to kunder (eller to klikk) som ber om samme analyse samtidig,
--    gir ett kall til leverandøren – den andre venter og får det samme svaret fra hurtigbufferen. Bare systemrollen
--    bruker tabellen (ingen kundedata: bare en hash og et tidspunkt).
create table if not exists ai_inflight (
  lock_key text primary key check (length(lock_key) <= 200),
  started_at timestamptz not null default now()
);
alter table ai_inflight enable row level security;

-- 4. Telling av e-post sendt siste døgn (e-postkvoten for ukesbrevene) uten å lese hele utboksen.
create index if not exists email_outbox_sent_idx on email_outbox (sent_at) where status = 'sent';
