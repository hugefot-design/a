#!/usr/bin/env bash
# Generalprøve: legger en kryptert kopi inn i en TOM database og kontrollerer at dataene faktisk er der.
# Brukes etter hver sikkerhetskopi (en kopi som ikke kan gjenopprettes, er ingen kopi) og ved ekte gjenoppretting.
#
# Bruk: BACKUP_PASSPHRASE=… scripts/backup/restore-check.sh kopi.dump.gpg postgres://…/tom_database
# ADVARSEL: målet må være en tom database – aldri produksjonsdatabasen.
set -euo pipefail
: "${BACKUP_PASSPHRASE:?Mangler BACKUP_PASSPHRASE}"
FILE="${1:?Oppgi den krypterte kopien}"
TARGET="${2:?Oppgi en tom måldatabase}"
PSQL="${PSQL:-psql}"
PG_RESTORE="${PG_RESTORE:-pg_restore}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
umask 077

TABLES_BEFORE=$("$PSQL" "$TARGET" -At -c "select count(*) from pg_tables where schemaname = 'public'")
if [ "$TABLES_BEFORE" != "0" ]; then
  echo "Måldatabasen er ikke tom ($TABLES_BEFORE tabeller) – stopper for ikke å skrive over noe." >&2
  exit 1
fi

gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt --output "$WORK/kopi.dump" "$FILE" 3<<<"$BACKUP_PASSPHRASE"

# Kopien lager skjemaet public selv; i en ny database finnes det allerede (tomt – sjekket over), så det fjernes først.
"$PSQL" "$TARGET" -v ON_ERROR_STOP=1 -q -c "drop schema if exists public cascade"
# Applikasjonsrollen trengs for radnivåsikkerheten (policyene viser til den).
"$PSQL" "$TARGET" -v ON_ERROR_STOP=1 -q -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'anbudradar_app') then create role anbudradar_app nologin; end if; end \$\$;"
"$PG_RESTORE" --no-owner --no-privileges --exit-on-error --dbname="$TARGET" "$WORK/kopi.dump"

# Kontroll: tabellene, migreringene og radene er der.
read -r TABLES MIGRATIONS ORGS USERS TENDERS < <("$PSQL" "$TARGET" -At -F ' ' -c "
  select (select count(*) from pg_tables where schemaname = 'public'),
         (select count(*) from schema_migrations),
         (select count(*) from organizations),
         (select count(*) from users),
         (select count(*) from tenders)")
echo "Gjenopprettet: $TABLES tabeller, $MIGRATIONS migreringer, $ORGS organisasjoner, $USERS brukere, $TENDERS anbud."
if [ "$TABLES" -lt 30 ] || [ "$MIGRATIONS" -lt 1 ]; then
  echo "Gjenopprettingen ser ufullstendig ut." >&2
  exit 1
fi
RLS_OFF=$("$PSQL" "$TARGET" -At -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity")
if [ "$RLS_OFF" != "0" ]; then
  echo "Radnivåsikkerhet mangler på $RLS_OFF tabeller etter gjenoppretting." >&2
  exit 1
fi
echo "Radnivåsikkerhet er på for alle tabeller."
