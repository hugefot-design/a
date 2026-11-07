-- Spørsmål om anbudet (AI med kontrollerte kildehenvisninger). Lagres i ai_analyses som før, med egen type.
-- Bare listen over tillatte typer utvides – ingen data endres.
alter table ai_analyses drop constraint if exists ai_analyses_kind_check;
alter table ai_analyses add constraint ai_analyses_kind_check check (kind in (
  'tender_analysis', 'match_explanation', 'profit_analysis', 'bid_checklist', 'bid_structure', 'bid_draft', 'bid_review', 'weekly_overview',
  'tender_chat'));
