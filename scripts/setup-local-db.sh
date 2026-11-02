#!/usr/bin/env bash
# Oppretter roller og databaser for lokal utvikling.
#
# Bruker standard libpq-variabler (PGHOST, PGPORT, PGUSER, PGPASSWORD) for å koble til
# som en superbruker. Eksempel:  PGUSER=postgres npm run db:setup-local
#
# Lager:
#   anbudradar_owner  – eier tabellene, brukes til migreringer og bakgrunnsjobber
#   anbudradar_app    – brukes av webappen, er underlagt radnivåsikkerhet (RLS)
#   anbudradar_dev / anbudradar_test – databaser
set -euo pipefail

OWNER_PASSWORD="${OWNER_PASSWORD:-anbudradar_owner_dev}"
APP_PASSWORD="${APP_PASSWORD:-anbudradar_app_dev}"
PSQL=(psql -v ON_ERROR_STOP=1 -X -q -d postgres)

"${PSQL[@]}" <<SQL
do \$\$
begin
  if not exists (select 1 from pg_roles where rolname = 'anbudradar_owner') then
    create role anbudradar_owner login password '${OWNER_PASSWORD}';
  end if;
  -- Som postgres-rollen i Supabase: kan opprette app-rollen selv (se scripts/migrate.ts).
  alter role anbudradar_owner createrole;
  if not exists (select 1 from pg_roles where rolname = 'anbudradar_app') then
    create role anbudradar_app login password '${APP_PASSWORD}' nobypassrls;
  end if;
end \$\$;
SQL

for db in anbudradar_dev anbudradar_test; do
  exists=$("${PSQL[@]}" -tAc "select 1 from pg_database where datname = '${db}'")
  if [ "$exists" != "1" ]; then
    "${PSQL[@]}" -c "create database ${db} owner anbudradar_owner encoding 'UTF8' template template0"
    echo "Opprettet database ${db}"
  fi
  "${PSQL[@]}" -c "grant connect on database ${db} to anbudradar_app"
done

echo "Ferdig. Sett DATABASE_URL og DATABASE_ADMIN_URL i .env og kjør: npm run db:migrate"
