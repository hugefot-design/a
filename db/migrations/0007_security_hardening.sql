-- Forsvar i dybden: databasen skal hindre misbruk selv om applikasjonskoden har en feil.
--
--  1. Webapp-rollen kan aldri gjøre noen til plattform-admin (kolonnerettigheter), og i en
--     organisasjonstransaksjon kan den bare endre sin egen brukerrad.
--  2. Bare eier/administrator kan endre medlemskap, invitasjoner, organisasjon og bedriftsprofil.
--     Medlemmer kan forlate organisasjonen selv. Bare eier kan gjøre noen til eier.
--  3. Bruksloggen for AI (kvoter og kostnad) kan ikke endres eller slettes av webappen.

-- Rollen til innlogget bruker i gjeldende organisasjon (null hvis ikke medlem).
create or replace function app_current_org_role() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select m.role
  from organization_members m
  where m.org_id = nullif(current_setting('app.org_id', true), '')::uuid
    and m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
$$;
revoke all on function app_current_org_role() from public;
grant execute on function app_current_org_role() to anbudradar_app;

-- ---------------------------------------------------------------------------
-- 1. Brukere
-- ---------------------------------------------------------------------------
revoke insert, update on users from anbudradar_app;
grant insert (email, name, password_hash) on users to anbudradar_app;
grant update (name, password_hash, email_verified_at, current_org_id, password_changed_at, last_login_at,
              failed_login_count, locked_until) on users to anbudradar_app;

drop policy if exists app_all on users;
create policy app_select on users for select to anbudradar_app using (true);
-- Uten brukerkontekst (registrering, innlogging, e-postlenker) gjelder vanlige regler i koden.
-- Med brukerkontekst (alt etter innlogging) kan bare egen rad endres.
create policy app_insert on users for insert to anbudradar_app
  with check ((select app_current_user_id()) is null);
create policy app_update on users for update to anbudradar_app
  using ((select app_current_user_id()) is null or id = (select app_current_user_id()))
  with check ((select app_current_user_id()) is null or id = (select app_current_user_id()));

-- ---------------------------------------------------------------------------
-- 2. Organisasjon, medlemskap, invitasjoner og profil
-- ---------------------------------------------------------------------------
-- Medlemskap opprettes bare av systemet (ny organisasjon eller godtatt invitasjon).
revoke insert on organization_members from anbudradar_app;
drop policy if exists tenant_write on organization_members;
drop policy if exists tenant_update on organization_members;
drop policy if exists tenant_delete on organization_members;
create policy manager_update on organization_members for update to anbudradar_app
  using (
    org_id = (select app_current_org_id())
    and (select app_current_org_role()) in ('owner', 'admin')
    and (role <> 'owner' or (select app_current_org_role()) = 'owner')
  )
  with check (
    org_id = (select app_current_org_id())
    and (role <> 'owner' or (select app_current_org_role()) = 'owner')
  );
create policy leave_or_manage_delete on organization_members for delete to anbudradar_app
  using (
    org_id = (select app_current_org_id())
    and (
      user_id = (select app_current_user_id())
      or ((select app_current_org_role()) in ('owner', 'admin') and (role <> 'owner' or (select app_current_org_role()) = 'owner'))
    )
  );

drop policy if exists tenant_update on organizations;
create policy manager_update on organizations for update to anbudradar_app
  using (id = (select app_current_org_id()) and (select app_current_org_role()) in ('owner', 'admin'))
  with check (id = (select app_current_org_id()));

drop policy if exists tenant_isolation on invitations;
create policy member_read on invitations for select to anbudradar_app
  using (org_id = (select app_current_org_id()));
create policy manager_write on invitations for insert to anbudradar_app
  with check (org_id = (select app_current_org_id()) and (select app_current_org_role()) in ('owner', 'admin'));
create policy manager_update on invitations for update to anbudradar_app
  using (org_id = (select app_current_org_id()) and (select app_current_org_role()) in ('owner', 'admin'))
  with check (org_id = (select app_current_org_id()));
create policy manager_delete on invitations for delete to anbudradar_app
  using (org_id = (select app_current_org_id()) and (select app_current_org_role()) in ('owner', 'admin'));

drop policy if exists tenant_isolation on company_profiles;
create policy member_read on company_profiles for select to anbudradar_app
  using (org_id = (select app_current_org_id()));
create policy manager_insert on company_profiles for insert to anbudradar_app
  with check (org_id = (select app_current_org_id()) and (select app_current_org_role()) in ('owner', 'admin'));
create policy manager_update on company_profiles for update to anbudradar_app
  using (org_id = (select app_current_org_id()) and (select app_current_org_role()) in ('owner', 'admin'))
  with check (org_id = (select app_current_org_id()));
create policy manager_delete on company_profiles for delete to anbudradar_app
  using (org_id = (select app_current_org_id()) and (select app_current_org_role()) in ('owner', 'admin'));

-- ---------------------------------------------------------------------------
-- 3. Bruk og kostnad
-- ---------------------------------------------------------------------------
revoke update, delete on usage_records from anbudradar_app;
