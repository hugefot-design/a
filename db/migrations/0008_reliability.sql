-- Driftssikkerhet: låser for planlagte oppgaver, e-post uten duplikater, refusjoner og
-- trygg behandling av Stripe-hendelser som leveres samtidig.

-- Leiebaserte låser (fungerer også bak en pooler i transaksjonsmodus, der advisory locks ikke er pålitelige).
create table if not exists task_locks (
  name text primary key,
  locked_by text not null,
  locked_until timestamptz not null
);
alter table task_locks enable row level security;

-- E-post: samme hendelse skal aldri gi to e-poster. Ekstra headere (f.eks. List-Unsubscribe).
alter table email_outbox add column if not exists dedupe_key text;
alter table email_outbox add column if not exists headers jsonb not null default '{}';
create unique index if not exists email_outbox_dedupe_uq on email_outbox (dedupe_key) where dedupe_key is not null;

-- Refusjoner og tvister.
alter table payments add column if not exists amount_refunded_cents bigint not null default 0;
alter table payments add column if not exists stripe_charge_id text;
alter table payments drop constraint if exists payments_status_check;
alter table payments add constraint payments_status_check
  check (status in ('paid', 'failed', 'open', 'void', 'uncollectible', 'refunded', 'partially_refunded', 'disputed'));
create index if not exists payments_charge_idx on payments (stripe_charge_id) where stripe_charge_id is not null;

-- Stripe: en hendelse behandles av én prosess om gangen (leveranser kan komme samtidig).
alter table stripe_events add column if not exists processing_started_at timestamptz;
alter table stripe_events add column if not exists attempts int not null default 0;
