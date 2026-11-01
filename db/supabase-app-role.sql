-- Kjør én gang i Supabase SQL Editor FØR første migrering.
-- Bytt ut passordet med et langt, tilfeldig passord og lagre det i DATABASE_URL.
--
-- Webappen kobler til som anbudradar_app, som er underlagt radnivåsikkerhet (RLS).
-- Migreringer og bakgrunnsjobber bruker postgres-rollen (DATABASE_ADMIN_URL).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anbudradar_app') then
    create role anbudradar_app login password 'BYTT-MEG-TIL-ET-LANGT-TILFELDIG-PASSORD' nobypassrls;
  end if;
end $$;

grant connect on database postgres to anbudradar_app;
