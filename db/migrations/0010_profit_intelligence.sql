-- Profit Intelligence: lønnsomhet, kontraktsrisiko, kapasitet og anbudspartnere.
--
-- Datamodellen skiller mellom:
--   * dokumenterte fakta (kunngjøringen og opplastede dokumenter – i tenders/tender_documents),
--   * brukerens opplysninger (org_economics, org_equipment, org_contracts, tender_calculations.inputs),
--   * AI-estimater (ai_analyses med kind 'profit_analysis', alltid med kildehenvisning eller merket som tolkning).
-- Beregnede tall (tender_calculations.result) lages av en deterministisk kalkulator fra de tre over.

-- Økonomiske forutsetninger og kapasitet per organisasjon (bedriftens egne tall).
create table if not exists org_economics (
  org_id uuid primary key references organizations(id) on delete cascade,
  hourly_cost numeric(12, 2) check (hourly_cost is null or hourly_cost >= 0),
  overhead_pct numeric(6, 2) check (overhead_pct is null or overhead_pct between 0 and 300),
  target_margin_pct numeric(6, 2) check (target_margin_pct is null or target_margin_pct between 0 and 90),
  min_margin_pct numeric(6, 2) check (min_margin_pct is null or min_margin_pct between 0 and 90),
  risk_buffer_pct numeric(6, 2) check (risk_buffer_pct is null or risk_buffer_pct between 0 and 100),
  bid_cost_hours numeric(10, 1) check (bid_cost_hours is null or bid_cost_hours >= 0),
  notes text check (notes is null or char_length(notes) <= 2000),
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Bemanning registreres som roller/grupper med antall – IKKE enkeltpersoner med navn (dataminimering).
create table if not exists org_staff (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  role text not null check (char_length(role) between 1 and 160),
  headcount int not null check (headcount between 0 and 100000),
  hours_per_year_each numeric(8, 1) check (hours_per_year_each is null or hours_per_year_each between 0 and 4000),
  certifications text[] not null default '{}' check (cardinality(certifications) <= 30),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists org_staff_org_idx on org_staff (org_id, created_at);

create table if not exists org_equipment (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  category text check (category is null or char_length(category) <= 60),
  quantity int not null default 1 check (quantity between 0 and 100000),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists org_equipment_org_idx on org_equipment (org_id, created_at);

-- Eksisterende kontrakter som binder kapasitet.
create table if not exists org_contracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  client text check (client is null or char_length(client) <= 200),
  start_date date,
  end_date date,
  hours_per_month numeric(10, 1) check (hours_per_month is null or hours_per_month >= 0),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (start_date is null or end_date is null or start_date <= end_date)
);
create index if not exists org_contracts_org_idx on org_contracts (org_id, end_date);

-- Bedriftens kalkyle for ett anbud. inputs = brukerens linjer og forutsetninger; result = beregnet.
create table if not exists tender_calculations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  inputs jsonb not null,
  result jsonb not null,
  recommendation text not null check (recommendation in ('bid', 'investigate', 'high_risk', 'insufficient_data')),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, tender_id)
);
create index if not exists tender_calculations_org_idx on tender_calculations (org_id, updated_at desc);

-- Anbudspartnere: frivillig, synlig for andre kunder BARE når organisasjonen har publisert profilen
-- (samtykke lagres med tidspunkt og tekstversjon). Profilen inneholder bare felt som er ment å deles.
create table if not exists partner_profiles (
  org_id uuid primary key references organizations(id) on delete cascade,
  published boolean not null default false,
  display_name text not null check (char_length(display_name) between 1 and 160),
  summary text check (summary is null or char_length(summary) <= 2000),
  capabilities text check (capabilities is null or char_length(capabilities) <= 3000),
  industries text[] not null default '{}',
  regions text[] not null default '{}',
  certifications text[] not null default '{}',
  partner_roles text[] not null default '{}' check (partner_roles <@ array['underleverandor', 'samarbeidspartner', 'hovedleverandor']::text[]),
  employee_count int check (employee_count is null or employee_count >= 0),
  consent_at timestamptz,
  consent_version text,
  published_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (not published or consent_at is not null)
);
create index if not exists partner_profiles_published_idx on partner_profiles (published) where published;

create table if not exists partner_requests (
  id uuid primary key default gen_random_uuid(),
  from_org_id uuid not null references organizations(id) on delete cascade,
  to_org_id uuid not null references organizations(id) on delete cascade,
  tender_id uuid references tenders(id) on delete set null,
  role_sought text not null check (role_sought in ('underleverandor', 'samarbeidspartner', 'hovedleverandor')),
  message text not null check (char_length(message) between 1 and 2000),
  -- Egenvurdering etter Konkurransetilsynets veileder: kan partene levere alene?
  self_assessment text not null check (self_assessment in ('ingen_kan_alene', 'bare_en_kan_alene', 'usikker')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  requester_contact_name text check (requester_contact_name is null or char_length(requester_contact_name) <= 120),
  requester_contact_email text check (requester_contact_email is null or char_length(requester_contact_email) <= 254),
  responder_contact_name text check (responder_contact_name is null or char_length(responder_contact_name) <= 120),
  responder_contact_email text check (responder_contact_email is null or char_length(responder_contact_email) <= 254),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  responded_by uuid references users(id) on delete set null,
  responded_at timestamptz,
  check (from_org_id <> to_org_id)
);
create index if not exists partner_requests_to_idx on partner_requests (to_org_id, created_at desc);
create index if not exists partner_requests_from_idx on partner_requests (from_org_id, created_at desc);

-- AI-analyse av lønnsomhet og kontraktsrisiko.
alter table ai_analyses drop constraint if exists ai_analyses_kind_check;
alter table ai_analyses add constraint ai_analyses_kind_check check (kind in (
  'tender_analysis', 'match_explanation', 'profit_analysis', 'bid_checklist', 'bid_structure', 'bid_draft', 'bid_review', 'weekly_overview'));

-- Nye varseltyper for partnerforespørsler.
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in (
  'new_match', 'saved_search', 'deadline', 'tender_update', 'cancellation',
  'weekly_summary', 'payment_failed', 'competitor_award', 'system', 'partner_request', 'partner_response'));

-- ---------------------------------------------------------------------------
-- Tilgang (radnivåsikkerhet). Alle medlemmer kan lese egne tall; bare eier/administrator kan endre
-- økonomi, utstyr, kontrakter og partnerprofil. Alle medlemmer kan jobbe med kalkyler.
-- ---------------------------------------------------------------------------
alter table org_economics enable row level security;
alter table org_staff enable row level security;
alter table org_equipment enable row level security;
alter table org_contracts enable row level security;
alter table tender_calculations enable row level security;
alter table partner_profiles enable row level security;
alter table partner_requests enable row level security;

grant select, insert, update, delete on org_economics, org_staff, org_equipment, org_contracts, tender_calculations, partner_profiles to anbudradar_app;
-- Forespørsler: appen kan opprette og lese, men bare endre svarfeltene (status og svarers kontaktinfo).
grant select, insert on partner_requests to anbudradar_app;
grant update (status, responder_contact_name, responder_contact_email, responded_by, responded_at) on partner_requests to anbudradar_app;

do $$
declare t text;
begin
  foreach t in array array['org_economics', 'org_staff', 'org_equipment', 'org_contracts'] loop
    execute format('create policy member_read on public.%I for select to anbudradar_app using (org_id = (select app_current_org_id()))', t);
    execute format(
      'create policy manager_insert on public.%I for insert to anbudradar_app
         with check (org_id = (select app_current_org_id()) and (select app_current_org_role()) in (''owner'', ''admin''))', t);
    execute format(
      'create policy manager_update on public.%I for update to anbudradar_app
         using (org_id = (select app_current_org_id()) and (select app_current_org_role()) in (''owner'', ''admin''))
         with check (org_id = (select app_current_org_id()))', t);
    execute format(
      'create policy manager_delete on public.%I for delete to anbudradar_app
         using (org_id = (select app_current_org_id()) and (select app_current_org_role()) in (''owner'', ''admin''))', t);
  end loop;
end $$;

create policy tenant_isolation on tender_calculations for all to anbudradar_app
  using (org_id = (select app_current_org_id())) with check (org_id = (select app_current_org_id()));

-- Partnerprofiler: egne profiler alltid; andres bare når de er publisert.
create policy read_published_or_own on partner_profiles for select to anbudradar_app
  using (published or org_id = (select app_current_org_id()));
create policy manager_insert on partner_profiles for insert to anbudradar_app
  with check (org_id = (select app_current_org_id()) and (select app_current_org_role()) in ('owner', 'admin'));
create policy manager_update on partner_profiles for update to anbudradar_app
  using (org_id = (select app_current_org_id()) and (select app_current_org_role()) in ('owner', 'admin'))
  with check (org_id = (select app_current_org_id()));
create policy manager_delete on partner_profiles for delete to anbudradar_app
  using (org_id = (select app_current_org_id()) and (select app_current_org_role()) in ('owner', 'admin'));

-- Forespørsler: bare synlige for de to organisasjonene. Kan bare sendes til publiserte profiler.
create policy involved_read on partner_requests for select to anbudradar_app
  using (from_org_id = (select app_current_org_id()) or to_org_id = (select app_current_org_id()));
create policy send_to_published on partner_requests for insert to anbudradar_app
  with check (
    from_org_id = (select app_current_org_id())
    and (select app_current_org_role()) in ('owner', 'admin')
    and status = 'pending'
    and responder_contact_name is null and responder_contact_email is null and responded_at is null
    and exists (select 1 from partner_profiles p where p.org_id = to_org_id and p.published)
    and exists (select 1 from partner_profiles p where p.org_id = from_org_id and p.published)
  );
create policy involved_update on partner_requests for update to anbudradar_app
  using ((from_org_id = (select app_current_org_id()) or to_org_id = (select app_current_org_id()))
         and (select app_current_org_role()) in ('owner', 'admin'))
  with check (from_org_id = (select app_current_org_id()) or to_org_id = (select app_current_org_id()));

-- Statusoverganger: bare mottaker kan godta/avslå, bare avsender kan trekke tilbake, og bare fra «pending».
-- Kontaktinfo fra mottaker kan bare settes ved godkjenning. Gjelder appens rolle (systemjobber er unntatt).
create or replace function partner_request_guard() returns trigger language plpgsql as $$
begin
  if current_user <> 'anbudradar_app' then
    return new;
  end if;
  if old.status <> 'pending' then
    raise exception 'Forespørselen er allerede besvart' using errcode = 'check_violation';
  end if;
  if new.status = 'withdrawn' then
    if old.from_org_id <> app_current_org_id() then
      raise exception 'Bare avsenderen kan trekke forespørselen' using errcode = 'insufficient_privilege';
    end if;
    if new.responder_contact_name is not null or new.responder_contact_email is not null then
      raise exception 'Ugyldig endring' using errcode = 'check_violation';
    end if;
  elsif new.status in ('accepted', 'declined') then
    if old.to_org_id <> app_current_org_id() then
      raise exception 'Bare mottakeren kan svare' using errcode = 'insufficient_privilege';
    end if;
    if new.status = 'declined' and (new.responder_contact_name is not null or new.responder_contact_email is not null) then
      raise exception 'Kontaktinfo deles bare ved godkjenning' using errcode = 'check_violation';
    end if;
  else
    raise exception 'Ugyldig status' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists partner_request_guard on partner_requests;
create trigger partner_request_guard before update on partner_requests for each row execute function partner_request_guard();
