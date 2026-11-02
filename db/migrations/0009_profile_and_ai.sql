-- Grundigere bedriftsprofil (brukes i matching, egnethetsvurdering og tilbudsutkast) og nye AI-oppgaver.

alter table company_profiles
  add column if not exists products text,
  add column if not exists competencies text,
  add column if not exists employee_count int check (employee_count is null or employee_count between 0 and 1000000),
  add column if not exists annual_revenue numeric(18, 2) check (annual_revenue is null or annual_revenue >= 0),
  add column if not exists reference_projects jsonb not null default '[]';

alter table ai_analyses drop constraint if exists ai_analyses_kind_check;
alter table ai_analyses add constraint ai_analyses_kind_check check (kind in (
  'tender_analysis', 'match_explanation', 'bid_checklist', 'bid_structure', 'bid_draft', 'bid_review', 'weekly_overview'));

-- Raskere oppslag av organisasjonens egne analyser per anbud.
create index if not exists ai_analyses_org_tender_idx on ai_analyses (org_id, tender_id, kind, created_at desc) where status = 'completed';
