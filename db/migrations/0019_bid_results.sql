-- Tilbudsresultat og læring. Bygger på lagrede anbud (bookmarks), som allerede har status
-- «Tilbud levert», «Vunnet» og «Ikke vunnet». Nye, valgfrie felt – bedriften fyller dem ut selv
-- (fra tildelingsbrevet). Ingen eksisterende data endres.
alter table bookmarks
  add column if not exists our_price numeric(18, 2) check (our_price is null or our_price >= 0),
  add column if not exists winning_price numeric(18, 2) check (winning_price is null or winning_price >= 0),
  add column if not exists winner_name text check (winner_name is null or char_length(winner_name) <= 200),
  add column if not exists outcome_reason text
    check (outcome_reason is null or outcome_reason in ('pris', 'kvalitet', 'kvalifikasjon', 'avvist', 'annet')),
  -- 'bruker' = satt av bedriften; 'tildeling' = bekreftet fra tildelingskunngjøringen (org.nr. stemte).
  add column if not exists outcome_source text check (outcome_source is null or outcome_source in ('bruker', 'tildeling')),
  add column if not exists submitted_at timestamptz,
  add column if not exists decided_at timestamptz;

create index if not exists bookmarks_results_idx on bookmarks (org_id, status) where status in ('submitted', 'won', 'lost');
