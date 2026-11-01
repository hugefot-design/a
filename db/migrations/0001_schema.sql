-- AnbudRadar – grunnskjema
-- Kjøres av eier-rollen (DATABASE_ADMIN_URL). Applikasjonsrollen "anbudradar_app"
-- må finnes på forhånd (se scripts/setup-local-db.sh eller db/supabase-app-role.sql).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anbudradar_app') then
    raise exception 'Rollen anbudradar_app finnes ikke. Kjør scripts/setup-local-db.sh (lokalt) eller db/supabase-app-role.sql (Supabase) før migrering.';
  end if;
end $$;

create extension if not exists citext;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Hjelpefunksjoner
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- RLS-kontekst settes per transaksjon av applikasjonen med set_config(..., true).
create or replace function app_current_user_id() returns uuid
language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create or replace function app_current_org_id() returns uuid
language sql stable as $$ select nullif(current_setting('app.org_id', true), '')::uuid $$;

create or replace function tender_status(p_lifecycle text, p_deadline timestamptz, p_published timestamptz)
returns text language sql stable as $$
  select case
    when p_lifecycle in ('awarded', 'cancelled', 'planned', 'direct_award', 'withdrawn') then p_lifecycle
    when p_deadline is not null and p_deadline > now() then 'open'
    when p_deadline is not null then 'closed'
    when p_published is not null and p_published > now() - interval '60 days' then 'open'
    else 'unknown'
  end
$$;

-- ---------------------------------------------------------------------------
-- Referansedata
-- ---------------------------------------------------------------------------
create table countries (
  code char(2) primary key,
  name_nb text not null,
  name_en text not null,
  currency char(3) not null,
  locale text not null,
  is_active boolean not null default false
);

create table regions (
  code text primary key,
  country_code char(2) not null references countries(code),
  name text not null,
  nuts_codes text[] not null default '{}',
  sort_order int not null default 0
);

create table industries (
  id text primary key,
  name_nb text not null,
  name_en text not null,
  description_nb text not null default '',
  cpv_prefixes text[] not null default '{}',
  keywords text[] not null default '{}',
  sort_order int not null default 0
);

create table cpv_codes (
  code text primary key check (code ~ '^[0-9]{8}$'),
  label_nb text,
  label_en text not null,
  division text generated always as (left(code, 2)) stored
);
create index cpv_codes_division_idx on cpv_codes (division);

-- ---------------------------------------------------------------------------
-- Oppdragsgivere og leverandører (offentlige data)
-- ---------------------------------------------------------------------------
create table authorities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  org_number text,
  country_code char(2) not null references countries(code),
  city text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index authorities_orgnr_uq on authorities (country_code, org_number) where org_number is not null;
create index authorities_norm_idx on authorities (country_code, normalized_name);
create index authorities_norm_trgm on authorities using gin (normalized_name gin_trgm_ops);
create trigger authorities_updated before update on authorities for each row execute function set_updated_at();

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  org_number text,
  country_code char(2) references countries(code),
  created_at timestamptz not null default now()
);
create unique index suppliers_orgnr_uq on suppliers (country_code, org_number) where org_number is not null;
create unique index suppliers_name_uq on suppliers (coalesce(country_code, '--'), normalized_name) where org_number is null;
create index suppliers_norm_trgm on suppliers using gin (normalized_name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Kunngjøringer (anbud)
-- ---------------------------------------------------------------------------
create table tenders (
  id uuid primary key default gen_random_uuid(),
  canonical_key text not null unique,
  procedure_id text,
  buyer_reference text,
  title text not null,
  description text,
  authority_id uuid references authorities(id) on delete set null,
  buyer_name text,
  buyer_org_number text,
  country_code char(2) not null references countries(code),
  nuts_codes text[] not null default '{}',
  region_codes text[] not null default '{}',
  place_text text,
  cpv_codes text[] not null default '{}',
  cpv_prefixes text[] not null default '{}',
  main_cpv text,
  industry_ids text[] not null default '{}',
  contract_nature text check (contract_nature in ('works', 'supplies', 'services')),
  procedure_type text,
  notice_type text,
  lifecycle text not null default 'competition'
    check (lifecycle in ('planned', 'competition', 'awarded', 'cancelled', 'direct_award', 'withdrawn', 'other')),
  estimated_value numeric(18, 2) check (estimated_value is null or estimated_value >= 0),
  currency char(3),
  published_at timestamptz,
  deadline_at timestamptz,
  deadline_time_known boolean not null default false,
  source_url text,
  documents_url text,
  received_tenders int,
  is_sample boolean not null default false,
  first_seen_at timestamptz not null default now(),
  source_updated_at timestamptz,
  last_checked_at timestamptz not null default now(),
  content_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_tsv tsvector generated always as (
    setweight(to_tsvector('norwegian', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('norwegian', coalesce(buyer_name, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(place_text, '')), 'C') ||
    setweight(to_tsvector('norwegian', coalesce(left(description, 20000), '')), 'D')
  ) stored
);
create unique index tenders_procedure_uq on tenders (procedure_id) where procedure_id is not null;
create index tenders_search_idx on tenders using gin (search_tsv);
create index tenders_cpv_prefixes_idx on tenders using gin (cpv_prefixes);
create index tenders_regions_idx on tenders using gin (region_codes);
create index tenders_industries_idx on tenders using gin (industry_ids);
create index tenders_deadline_idx on tenders (deadline_at);
create index tenders_published_idx on tenders (published_at desc);
create index tenders_first_seen_idx on tenders (first_seen_at desc);
create index tenders_lifecycle_idx on tenders (lifecycle);
create index tenders_value_idx on tenders (estimated_value);
create index tenders_authority_idx on tenders (authority_id);
create index tenders_buyer_trgm on tenders using gin (buyer_name gin_trgm_ops);
create index tenders_title_trgm on tenders using gin (title gin_trgm_ops);
create index tenders_buyer_orgnr_idx on tenders (buyer_org_number);
create trigger tenders_updated before update on tenders for each row execute function set_updated_at();

create table tender_sources (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  source text not null check (source in ('ted', 'doffin', 'manual', 'sample')),
  source_notice_id text not null,
  notice_type text,
  source_url text,
  published_at timestamptz,
  raw jsonb,
  content_hash text not null,
  fetched_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (source, source_notice_id)
);
create index tender_sources_tender_idx on tender_sources (tender_id);

create table tender_updates (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  source text,
  change_type text not null check (change_type in (
    'deadline_changed', 'cancelled', 'awarded', 'value_changed', 'details_changed', 'documents_changed', 'removed', 'new_notice')),
  summary text not null,
  old_value jsonb,
  new_value jsonb,
  detected_at timestamptz not null default now(),
  notified_at timestamptz
);
create index tender_updates_tender_idx on tender_updates (tender_id, detected_at desc);
create index tender_updates_pending_idx on tender_updates (detected_at) where notified_at is null;

create table contract_awards (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete set null,
  supplier_name text not null,
  lot_title text,
  awarded_value numeric(18, 2) check (awarded_value is null or awarded_value >= 0),
  currency char(3),
  award_date date,
  source text not null,
  source_notice_id text not null,
  created_at timestamptz not null default now()
);
create unique index contract_awards_uq on contract_awards (source, source_notice_id, lower(supplier_name), coalesce(lot_title, ''));
create index contract_awards_supplier_idx on contract_awards (supplier_id);
create index contract_awards_tender_idx on contract_awards (tender_id);
create index contract_awards_date_idx on contract_awards (award_date desc);

-- ---------------------------------------------------------------------------
-- Brukere, sesjoner og organisasjoner
-- ---------------------------------------------------------------------------
create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  name text not null check (char_length(name) between 1 and 120),
  password_hash text not null,
  email_verified_at timestamptz,
  is_platform_admin boolean not null default false,
  current_org_id uuid,
  password_changed_at timestamptz not null default now(),
  last_login_at timestamptz,
  failed_login_count int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger users_updated before update on users for each row execute function set_updated_at();

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  csrf_token text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text,
  ip_hash text
);
create index sessions_user_idx on sessions (user_id);
create index sessions_expires_idx on sessions (expires_at);

create table email_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  purpose text not null check (purpose in ('verify_email', 'reset_password')),
  token_hash text not null unique,
  email citext not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index email_tokens_user_idx on email_tokens (user_id, purpose);

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  org_number text,
  country_code char(2) not null default 'NO' references countries(code),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_updated before update on organizations for each row execute function set_updated_at();

alter table users add constraint users_current_org_fk
  foreign key (current_org_id) references organizations(id) on delete set null;

create table organization_members (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index organization_members_user_idx on organization_members (user_id);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  email citext not null,
  role text not null check (role in ('admin', 'member')),
  token_hash text not null unique,
  invited_by uuid references users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index invitations_pending_uq on invitations (org_id, email) where accepted_at is null and revoked_at is null;

create table company_profiles (
  org_id uuid primary key references organizations(id) on delete cascade,
  company_name text not null,
  org_number text,
  description text,
  industries text[] not null default '{}',
  services text,
  keywords text[] not null default '{}',
  cpv_codes text[] not null default '{}',
  regions text[] not null default '{}',
  countries text[] not null default '{NO}',
  company_size text check (company_size in ('1-9', '10-49', '50-249', '250+')),
  certifications text[] not null default '{}',
  experience text,
  min_contract_value numeric(18, 2),
  max_contract_value numeric(18, 2),
  contract_types text[] not null default '{}',
  excluded_cpv text[] not null default '{}',
  excluded_keywords text[] not null default '{}',
  min_days_to_deadline int not null default 10 check (min_days_to_deadline between 0 and 365),
  version int not null default 1,
  onboarding_completed_at timestamptz,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger company_profiles_updated before update on company_profiles for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Brukerfunksjoner (tenant-data)
-- ---------------------------------------------------------------------------
create table saved_searches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  filters jsonb not null,
  nl_query text,
  alert_enabled boolean not null default false,
  alert_frequency text not null default 'daily' check (alert_frequency in ('instant', 'daily', 'weekly')),
  last_alerted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index saved_searches_org_idx on saved_searches (org_id, created_at desc);
create index saved_searches_alert_idx on saved_searches (alert_enabled) where alert_enabled;
create trigger saved_searches_updated before update on saved_searches for each row execute function set_updated_at();

create table bookmarks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  created_by uuid references users(id) on delete set null,
  status text not null default 'watching' check (status in ('watching', 'preparing', 'submitted', 'won', 'lost', 'declined')),
  note text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, tender_id)
);
create index bookmarks_tender_idx on bookmarks (tender_id);
create trigger bookmarks_updated before update on bookmarks for each row execute function set_updated_at();

create table match_results (
  org_id uuid not null references organizations(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  score int not null check (score between 0 and 100),
  breakdown jsonb not null,
  excluded boolean not null default false,
  profile_version int not null,
  computed_at timestamptz not null default now(),
  primary key (org_id, tender_id)
);
create index match_results_score_idx on match_results (org_id, score desc) where not excluded;
create index match_results_tender_idx on match_results (tender_id);

create table competitor_watch (
  org_id uuid not null references organizations(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (org_id, supplier_id)
);

-- ---------------------------------------------------------------------------
-- Varsler og e-post
-- ---------------------------------------------------------------------------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  type text not null check (type in (
    'new_match', 'saved_search', 'deadline', 'tender_update', 'cancellation',
    'weekly_summary', 'payment_failed', 'competitor_award', 'system')),
  tender_id uuid references tenders(id) on delete cascade,
  title text not null,
  body text,
  url text,
  dedupe_key text not null,
  read_at timestamptz,
  emailed_at timestamptz,
  email_skipped boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_unemailed_idx on notifications (created_at) where emailed_at is null and email_skipped = false;

create table notification_preferences (
  user_id uuid not null references users(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  email_frequency text not null default 'daily' check (email_frequency in ('instant', 'daily', 'weekly', 'off')),
  new_matches boolean not null default true,
  match_threshold int not null default 60 check (match_threshold between 0 and 100),
  saved_search_alerts boolean not null default true,
  deadline_reminders boolean not null default true,
  tender_changes boolean not null default true,
  weekly_summary boolean not null default true,
  last_digest_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, org_id)
);
create trigger notification_preferences_updated before update on notification_preferences for each row execute function set_updated_at();

create table email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_email citext not null,
  subject text not null,
  html text not null,
  text_body text not null,
  kind text not null,
  user_id uuid references users(id) on delete set null,
  org_id uuid references organizations(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'logged')),
  provider text,
  provider_message_id text,
  attempts int not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index email_outbox_pending_idx on email_outbox (next_attempt_at) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Dokumenter og AI
-- ---------------------------------------------------------------------------
create table tender_documents (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  org_id uuid references organizations(id) on delete cascade,
  title text not null,
  source_url text,
  storage_key text,
  mime_type text,
  size_bytes bigint,
  page_count int,
  sha256 text,
  text_status text not null default 'pending' check (text_status in ('pending', 'extracted', 'failed', 'unsupported')),
  text_error text,
  uploaded_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index tender_documents_tender_idx on tender_documents (tender_id, org_id);

create table tender_document_pages (
  document_id uuid not null references tender_documents(id) on delete cascade,
  org_id uuid references organizations(id) on delete cascade,
  page_number int not null check (page_number > 0),
  content text not null,
  primary key (document_id, page_number)
);

create table ai_analyses (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'tender_analysis', 'match_explanation', 'bid_checklist', 'bid_draft', 'bid_review', 'weekly_overview')),
  tender_id uuid references tenders(id) on delete cascade,
  org_id uuid references organizations(id) on delete cascade,
  workspace_id uuid,
  input_hash text not null,
  prompt_version text not null,
  provider text not null,
  model text not null,
  status text not null check (status in ('completed', 'failed')),
  result jsonb,
  error text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  duration_ms int,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index ai_analyses_tender_idx on ai_analyses (tender_id, kind, created_at desc);
create index ai_analyses_cache_idx on ai_analyses (kind, input_hash) where status = 'completed';
create index ai_analyses_created_idx on ai_analyses (created_at desc);

create table usage_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  kind text not null,
  quantity int not null default 1,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  cached boolean not null default false,
  period text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  created_at timestamptz not null default now()
);
create index usage_records_org_period_idx on usage_records (org_id, period, kind);

-- ---------------------------------------------------------------------------
-- Tilbudsarbeid (bid workspace)
-- ---------------------------------------------------------------------------
create table bid_workspaces (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'submitted', 'archived')),
  owner_user_id uuid references users(id) on delete set null,
  review_requested_by uuid references users(id) on delete set null,
  review_requested_at timestamptz,
  approved_by uuid references users(id) on delete set null,
  approved_at timestamptz,
  submitted_by uuid references users(id) on delete set null,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, tender_id)
);
create trigger bid_workspaces_updated before update on bid_workspaces for each row execute function set_updated_at();
alter table ai_analyses add constraint ai_analyses_workspace_fk
  foreign key (workspace_id) references bid_workspaces(id) on delete cascade;

create table bid_checklist_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references bid_workspaces(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 500),
  category text not null default 'annet',
  source text not null default 'manual' check (source in ('manual', 'standard', 'ai', 'notice')),
  source_ref text,
  is_done boolean not null default false,
  done_by uuid references users(id) on delete set null,
  done_at timestamptz,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index bid_checklist_ws_idx on bid_checklist_items (workspace_id, sort_order);

create table bid_sections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references bid_workspaces(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  requirement text,
  content text not null default '',
  ai_assisted boolean not null default false,
  sort_order int not null default 0,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bid_sections_ws_idx on bid_sections (workspace_id, sort_order);
create trigger bid_sections_updated before update on bid_sections for each row execute function set_updated_at();

create table bid_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references bid_workspaces(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  category text not null default 'vedlegg',
  storage_key text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index bid_documents_ws_idx on bid_documents (workspace_id);

-- ---------------------------------------------------------------------------
-- Abonnement og betaling
-- ---------------------------------------------------------------------------
create table subscriptions (
  org_id uuid primary key references organizations(id) on delete cascade,
  plan text not null check (plan in ('free', 'starter', 'professional', 'business', 'enterprise')),
  status text not null check (status in (
    'trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused')),
  source text not null check (source in ('trial', 'stripe', 'manual')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  manual_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger subscriptions_updated before update on subscriptions for each row execute function set_updated_at();

create table payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  stripe_invoice_id text unique,
  amount_cents bigint not null,
  currency char(3) not null,
  status text not null check (status in ('paid', 'failed', 'open', 'void', 'uncollectible')),
  hosted_invoice_url text,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz not null default now()
);
create index payments_org_idx on payments (org_id, created_at desc);

create table stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

-- ---------------------------------------------------------------------------
-- Drift: revisjonslogg, import, rapporter, jobber
-- ---------------------------------------------------------------------------
create table audit_logs (
  id bigint generated always as identity primary key,
  org_id uuid references organizations(id) on delete set null,
  actor_user_id uuid references users(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}',
  ip_hash text,
  created_at timestamptz not null default now()
);
create index audit_logs_org_idx on audit_logs (org_id, created_at desc);
create index audit_logs_created_idx on audit_logs (created_at desc);

create table data_sources (
  id text primary key check (id in ('ted', 'doffin', 'manual', 'sample')),
  name text not null,
  enabled boolean not null default false,
  verified_live boolean not null default false,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  cursor jsonb not null default '{}',
  notes text,
  updated_at timestamptz not null default now()
);
create trigger data_sources_updated before update on data_sources for each row execute function set_updated_at();

create table import_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null references data_sources(id),
  status text not null check (status in ('running', 'success', 'partial', 'failed')),
  trigger text not null check (trigger in ('schedule', 'manual', 'cli', 'upload')),
  params jsonb not null default '{}',
  fetched_count int not null default 0,
  created_count int not null default 0,
  updated_count int not null default 0,
  unchanged_count int not null default 0,
  duplicate_count int not null default 0,
  error_count int not null default 0,
  error_summary text,
  triggered_by uuid references users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index import_runs_source_idx on import_runs (source, started_at desc);

create table import_errors (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references import_runs(id) on delete cascade,
  source text,
  source_notice_id text,
  stage text not null,
  error text not null,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index import_errors_run_idx on import_errors (run_id);

create table search_events (
  id bigint generated always as identity primary key,
  org_id uuid references organizations(id) on delete set null,
  industries text[] not null default '{}',
  regions text[] not null default '{}',
  has_keyword boolean not null default false,
  used_nl boolean not null default false,
  result_count int not null default 0,
  created_at timestamptz not null default now()
);
create index search_events_created_idx on search_events (created_at desc);

create table reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('data_error', 'contact')),
  tender_id uuid references tenders(id) on delete set null,
  org_id uuid references organizations(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  name text,
  email citext,
  message text not null check (char_length(message) between 1 and 5000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_at timestamptz,
  resolved_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index reports_status_idx on reports (status, created_at desc);

create table rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count int not null
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  dedupe_key text,
  run_at timestamptz not null default now(),
  attempts int not null default 0,
  max_attempts int not null default 3,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_queue_idx on jobs (run_at) where status = 'queued';
create unique index jobs_dedupe_uq on jobs (dedupe_key) where dedupe_key is not null and status in ('queued', 'running');

create table worker_heartbeats (
  worker_id text primary key,
  last_seen_at timestamptz not null,
  info jsonb not null default '{}'
);

create table scheduled_task_runs (
  task text primary key,
  last_run_at timestamptz not null
);
