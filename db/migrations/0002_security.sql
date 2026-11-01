-- AnbudRadar – tilgangskontroll
--
-- Modell:
--   * Eier-rollen (migreringer, bakgrunnsjobber, admin, webhooks) eier tabellene og
--     omgås av RLS som tabelleier.
--   * Applikasjonsrollen anbudradar_app brukes for alle forespørsler fra innloggede
--     brukere. RLS er slått på for ALLE tabeller, og policyene gjelder kun denne rollen.
--     Andre roller (f.eks. Supabase sine anon/authenticated) får dermed ingen tilgang.
--   * Tenant-isolasjon: applikasjonen setter app.org_id og app.user_id per transaksjon.

-- Fjern eventuelle standardrettigheter (Supabase gir anon/authenticated tilgang til public).
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
    end if;
  end loop;
end $$;

grant usage on schema public to anbudradar_app;
grant execute on function app_current_user_id(), app_current_org_id(), tender_status(text, timestamptz, timestamptz)
  to anbudradar_app;

-- Slå på RLS for alle tabeller i skjemaet.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Offentlige data: lesetilgang for applikasjonen, skriving kun via systemet.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'countries', 'regions', 'industries', 'cpv_codes', 'authorities', 'suppliers',
    'tenders', 'tender_sources', 'tender_updates', 'contract_awards', 'data_sources'
  ] loop
    execute format('grant select on public.%I to anbudradar_app', t);
    execute format('create policy app_read on public.%I for select to anbudradar_app using (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Autentisering: applikasjonen trenger full tilgang før tenant er kjent.
-- ---------------------------------------------------------------------------
grant select, insert, update on users to anbudradar_app;
create policy app_all on users for all to anbudradar_app using (true) with check (true);

grant select, insert, update, delete on sessions, email_tokens, rate_limits to anbudradar_app;
create policy app_all on sessions for all to anbudradar_app using (true) with check (true);
create policy app_all on email_tokens for all to anbudradar_app using (true) with check (true);
create policy app_all on rate_limits for all to anbudradar_app using (true) with check (true);

-- E-postutboks og jobbkø håndteres kun av systemrollen.

-- ---------------------------------------------------------------------------
-- Organisasjoner og medlemskap
-- ---------------------------------------------------------------------------
grant select, update on organizations to anbudradar_app;
create policy member_read on organizations for select to anbudradar_app
  using (
    id = app_current_org_id()
    or exists (select 1 from organization_members m where m.org_id = organizations.id and m.user_id = app_current_user_id())
  );
create policy tenant_update on organizations for update to anbudradar_app
  using (id = app_current_org_id()) with check (id = app_current_org_id());

grant select, insert, update, delete on organization_members to anbudradar_app;
create policy member_read on organization_members for select to anbudradar_app
  using (org_id = app_current_org_id() or user_id = app_current_user_id());
create policy tenant_write on organization_members for insert to anbudradar_app
  with check (org_id = app_current_org_id());
create policy tenant_update on organization_members for update to anbudradar_app
  using (org_id = app_current_org_id()) with check (org_id = app_current_org_id());
create policy tenant_delete on organization_members for delete to anbudradar_app
  using (org_id = app_current_org_id());

-- ---------------------------------------------------------------------------
-- Rene tenant-tabeller: alt begrenses til gjeldende organisasjon.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'invitations', 'company_profiles', 'saved_searches', 'bookmarks', 'match_results',
    'competitor_watch', 'usage_records', 'bid_workspaces', 'bid_checklist_items',
    'bid_sections', 'bid_documents'
  ] loop
    execute format('grant select, insert, update, delete on public.%I to anbudradar_app', t);
    execute format(
      'create policy tenant_isolation on public.%I for all to anbudradar_app
         using (org_id = app_current_org_id()) with check (org_id = app_current_org_id())', t);
  end loop;
end $$;

-- Abonnement og betalinger kan kun leses; endres av webhooks/systemet.
grant select on subscriptions, payments to anbudradar_app;
create policy tenant_read on subscriptions for select to anbudradar_app using (org_id = app_current_org_id());
create policy tenant_read on payments for select to anbudradar_app using (org_id = app_current_org_id());

-- Varsler er personlige innenfor organisasjonen.
grant select, update on notifications to anbudradar_app;
create policy own_notifications on notifications for all to anbudradar_app
  using (org_id = app_current_org_id() and user_id = app_current_user_id())
  with check (org_id = app_current_org_id() and user_id = app_current_user_id());

grant select, insert, update on notification_preferences to anbudradar_app;
create policy own_preferences on notification_preferences for all to anbudradar_app
  using (org_id = app_current_org_id() and user_id = app_current_user_id())
  with check (org_id = app_current_org_id() and user_id = app_current_user_id());

-- Dokumenter: offentlige (org_id null) kan leses av alle, private kun av egen org.
grant select, insert, update, delete on tender_documents, tender_document_pages to anbudradar_app;
create policy doc_read on tender_documents for select to anbudradar_app
  using (org_id is null or org_id = app_current_org_id());
create policy doc_write on tender_documents for insert to anbudradar_app with check (org_id = app_current_org_id());
create policy doc_update on tender_documents for update to anbudradar_app
  using (org_id = app_current_org_id()) with check (org_id = app_current_org_id());
create policy doc_delete on tender_documents for delete to anbudradar_app using (org_id = app_current_org_id());
create policy page_read on tender_document_pages for select to anbudradar_app
  using (org_id is null or org_id = app_current_org_id());
create policy page_write on tender_document_pages for insert to anbudradar_app with check (org_id = app_current_org_id());
create policy page_delete on tender_document_pages for delete to anbudradar_app using (org_id = app_current_org_id());

-- AI-analyser: globale (fra offentlig kunngjøringstekst) skrives kun av systemet.
grant select, insert on ai_analyses to anbudradar_app;
create policy ai_read on ai_analyses for select to anbudradar_app
  using (org_id is null or org_id = app_current_org_id());
create policy ai_write on ai_analyses for insert to anbudradar_app with check (org_id = app_current_org_id());

-- Revisjonslogg: organisasjonen ser egne hendelser; brukerhendelser uten org kan skrives.
grant select, insert on audit_logs to anbudradar_app;
create policy audit_read on audit_logs for select to anbudradar_app using (org_id = app_current_org_id());
create policy audit_write on audit_logs for insert to anbudradar_app
  with check (org_id is null or org_id = app_current_org_id());

-- Søkestatistikk og rapporter (kun innsending).
grant insert on search_events, reports to anbudradar_app;
create policy event_write on search_events for insert to anbudradar_app
  with check (org_id is null or org_id = app_current_org_id());
create policy report_write on reports for insert to anbudradar_app
  with check (org_id is null or org_id = app_current_org_id());

grant usage on all sequences in schema public to anbudradar_app;
