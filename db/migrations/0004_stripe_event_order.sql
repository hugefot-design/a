-- Stripe kan levere webhook-hendelser i vilkårlig rekkefølge. Vi lagrer tidspunktet for
-- hendelsen som sist oppdaterte abonnementet, og ignorerer eldre hendelser.
alter table subscriptions add column if not exists stripe_event_at timestamptz;
