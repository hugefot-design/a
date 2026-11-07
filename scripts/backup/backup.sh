#!/usr/bin/env bash
# Tar en kryptert sikkerhetskopi av databasen (skjemaet public: alle AnbudRadar-tabeller og data).
#   pg_dump (custom-format, komprimert)  →  gpg AES-256 med passordfrasen  →  én fil.
# Passordfrasen leses fra en egen fildeskriptor – den står aldri på kommandolinjen eller i loggen.
#
# Bruk: BACKUP_DATABASE_URL=… BACKUP_PASSPHRASE=… scripts/backup/backup.sh utfil.dump.gpg
set -euo pipefail
: "${BACKUP_DATABASE_URL:?Mangler BACKUP_DATABASE_URL}"
: "${BACKUP_PASSPHRASE:?Mangler BACKUP_PASSPHRASE}"
OUT="${1:?Oppgi filnavn for kopien}"
if [ "${#BACKUP_PASSPHRASE}" -lt 24 ]; then
  echo "BACKUP_PASSPHRASE må være minst 24 tegn." >&2
  exit 1
fi
PG_DUMP="${PG_DUMP:-pg_dump}"
umask 077
# --extension: citext og pg_trgm følger med, så kopien kan legges inn i en helt tom database.
"$PG_DUMP" --format=custom --compress=6 --no-owner --no-privileges --schema=public \
  --extension=citext --extension=pg_trgm --dbname="$BACKUP_DATABASE_URL" \
  | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
      --symmetric --cipher-algo AES256 --output "$OUT" 3<<<"$BACKUP_PASSPHRASE"
SIZE=$(wc -c <"$OUT")
if [ "$SIZE" -lt 1024 ]; then
  echo "Kopien er mistenkelig liten ($SIZE byte) – stopper." >&2
  exit 1
fi
echo "Kryptert kopi laget: $(basename "$OUT") ($SIZE byte)"
