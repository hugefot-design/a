-- Forsvar i dybden for organisasjonsisolasjon.
--
-- 1) Organisasjonskonteksten (app.org_id) gjelder bare hvis brukeren i app.user_id faktisk er
--    medlem av organisasjonen. En feil i applikasjonskoden som setter feil org_id gir dermed
--    ingen tilgang, i stedet for tilgang til en annen kundes data.
create or replace function app_current_org_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select m.org_id
  from organization_members m
  where m.org_id = nullif(current_setting('app.org_id', true), '')::uuid
    and m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
$$;
revoke all on function app_current_org_id() from public;
grant execute on function app_current_org_id() to anbudradar_app;

-- 2) Evaluer kontekstfunksjonene én gang per spørring (InitPlan) i stedet for én gang per rad.
do $$
declare
  p record;
  new_qual text;
  new_check text;
begin
  for p in select schemaname, tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' loop
    new_qual := replace(replace(p.qual, 'app_current_org_id()', '(select app_current_org_id())'), 'app_current_user_id()', '(select app_current_user_id())');
    new_check := replace(replace(p.with_check, 'app_current_org_id()', '(select app_current_org_id())'), 'app_current_user_id()', '(select app_current_user_id())');
    if new_qual is distinct from p.qual then
      execute format('alter policy %I on %I.%I using (%s)', p.policyname, p.schemaname, p.tablename, new_qual);
    end if;
    if new_check is distinct from p.with_check then
      execute format('alter policy %I on %I.%I with check (%s)', p.policyname, p.schemaname, p.tablename, new_check);
    end if;
  end loop;
end $$;
