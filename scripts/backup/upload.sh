#!/usr/bin/env bash
# Laster opp en kryptert sikkerhetskopi til en PRIVAT bøtte i Supabase Storage og rydder bort gamle kopier.
#  - Bøtta opprettes som privat hvis den mangler. Er den offentlig, stopper skriptet uten å laste opp.
#  - Kopier eldre enn KEEP_DAYS slettes, men den nyeste beholdes alltid.
#  - Tjenestenøkkelen sendes til curl via standard inn (ikke som argument), så den ikke vises i prosesslisten eller loggen.
#
# Bruk: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… [BUCKET=sikkerhetskopier] [KEEP_DAYS=30] scripts/backup/upload.sh fil.dump.gpg
set -euo pipefail
: "${SUPABASE_URL:?Mangler SUPABASE_URL}"
: "${SUPABASE_SERVICE_ROLE_KEY:?Mangler SUPABASE_SERVICE_ROLE_KEY}"
FILE="${1:?Oppgi filen som skal lastes opp}"
BUCKET="${BUCKET:-sikkerhetskopier}"
KEEP_DAYS="${KEEP_DAYS:-30}"
MAX_BYTES="${MAX_BYTES:-52428800}" # 50 MB – grensen per fil i Supabase sin gratisplan
API="${SUPABASE_URL%/}/storage/v1"
NAME="$(basename "$FILE")"
case "$NAME" in anbudradar-*.dump.gpg) ;; *) echo "Uventet filnavn: $NAME" >&2; exit 1 ;; esac

# Kall mot Supabase med nøkkelen i hodene via standard inn. Skriver svaret til $OUT og returnerer HTTP-koden.
OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT
api() {
  local method="$1" url="$2"
  shift 2
  printf 'header = "Authorization: Bearer %s"\nheader = "apikey: %s"\n' "$SUPABASE_SERVICE_ROLE_KEY" "$SUPABASE_SERVICE_ROLE_KEY" \
    | curl -sS -K - -o "$OUT" -w '%{http_code}' -X "$method" "$url" "$@"
}

SIZE=$(wc -c <"$FILE")
if [ "$SIZE" -gt "$MAX_BYTES" ]; then
  echo "Kopien er $SIZE byte – over grensen på $MAX_BYTES byte per fil i Supabase. Se docs/DRIFT.md." >&2
  exit 1
fi

# 1. Bøtta: finnes, og er privat?
code=$(api GET "$API/bucket/$BUCKET")
if [ "$code" = "200" ]; then
  if python3 -c "import json,sys; sys.exit(0 if json.load(open(sys.argv[1])).get('public') else 1)" "$OUT"; then
    echo "Bøtta «$BUCKET» er OFFENTLIG – laster ikke opp. Gjør den privat i Supabase først." >&2
    exit 1
  fi
elif [ "$code" = "400" ] || [ "$code" = "404" ]; then
  code=$(api POST "$API/bucket" -H 'Content-Type: application/json' --data "{\"id\":\"$BUCKET\",\"name\":\"$BUCKET\",\"public\":false}")
  [ "$code" = "200" ] || { echo "Kunne ikke opprette bøtta (HTTP $code)." >&2; exit 1; }
  echo "Opprettet privat bøtte «$BUCKET»."
else
  echo "Kunne ikke lese bøtta (HTTP $code)." >&2
  exit 1
fi

# 2. Last opp (overskriver aldri en eksisterende kopi).
code=$(api POST "$API/object/$BUCKET/db/$NAME" -H 'Content-Type: application/octet-stream' -H 'x-upsert: false' --data-binary @"$FILE")
[ "$code" = "200" ] || { echo "Opplastingen feilet (HTTP $code)." >&2; exit 1; }
echo "Lastet opp db/$NAME ($SIZE byte) til privat bøtte."

# 3. Rydd: slett kopier eldre enn KEEP_DAYS, men behold alltid den nyeste.
code=$(api POST "$API/object/list/$BUCKET" -H 'Content-Type: application/json' --data '{"prefix":"db","limit":1000,"offset":0,"sortBy":{"column":"name","order":"asc"}}')
[ "$code" = "200" ] || { echo "Kunne ikke liste kopiene (HTTP $code) – ingen sletting." >&2; exit 0; }
OLD=$(python3 - "$OUT" "$KEEP_DAYS" <<'PY'
import json, re, sys, datetime
items = json.load(open(sys.argv[1]))
keep_days = int(sys.argv[2])
cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=keep_days)
dated = []
for it in items:
    m = re.fullmatch(r"anbudradar-(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})Z\.dump\.gpg", it.get("name") or "")
    if m:
        ts = datetime.datetime.fromisoformat(f"{m[1]}T{m[2]}:{m[3]}:00+00:00")
        dated.append((ts, it["name"]))
dated.sort()
newest = dated[-1][1] if dated else None
print(json.dumps([f"db/{name}" for ts, name in dated if ts < cutoff and name != newest]))
PY
)
if [ "$OLD" != "[]" ]; then
  code=$(api DELETE "$API/object/$BUCKET" -H 'Content-Type: application/json' --data "{\"prefixes\":$OLD}")
  [ "$code" = "200" ] || { echo "Sletting av gamle kopier feilet (HTTP $code)." >&2; exit 1; }
  echo "Slettet $(python3 -c "import json,sys; print(len(json.loads(sys.argv[1])))" "$OLD") kopi(er) eldre enn $KEEP_DAYS dager."
fi
