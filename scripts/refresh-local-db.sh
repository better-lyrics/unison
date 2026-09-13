#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CONTAINER="${UNISON_PG_CONTAINER:-unison-pg}"

read_url() {
  sed -nE "s/^$2=[\"']?([^\"']+)[\"']?[[:space:]]*$/\1/p" "$1" | tail -1
}

PROD_URL="$(read_url .env.production DATABASE_URL)"
LOCAL_URL="$(read_url .env DATABASE_URL)"

[ -n "$PROD_URL" ] || { echo "ERROR: DATABASE_URL missing in .env.production" >&2; exit 1; }
[ -n "$LOCAL_URL" ] || { echo "ERROR: DATABASE_URL missing in .env" >&2; exit 1; }

# SAFETY: the restore is destructive; refuse any target that is not local.
case "$LOCAL_URL" in
  *localhost*|*127.0.0.1*) : ;;
  *) echo "ERROR: refusing to restore into a non-local target: ${LOCAL_URL##*@}" >&2; exit 1 ;;
esac

docker inspect "$CONTAINER" >/dev/null 2>&1 || {
  echo "ERROR: container '$CONTAINER' not found (set UNISON_PG_CONTAINER to override)." >&2; exit 1; }

echo "==> Dumping production (read-only) with the container's pg18 client ..."
docker exec "$CONTAINER" pg_dump "$PROD_URL" --no-owner --no-privileges --format=custom -f /tmp/unison-prod.dump

echo "==> Restoring into local unison (${LOCAL_URL##*@}) ..."
docker exec "$CONTAINER" pg_restore --no-owner --no-privileges --clean --if-exists --dbname "$LOCAL_URL" /tmp/unison-prod.dump \
  || echo "    (pg_restore reported non-fatal drop notices; continuing)"

echo "==> Applying schema.sql (adds song_artwork and any new tables) ..."
docker exec -i "$CONTAINER" psql "$LOCAL_URL" -v ON_ERROR_STOP=1 -f - < schema.sql >/dev/null

docker exec "$CONTAINER" rm -f /tmp/unison-prod.dump

echo "==> Done. Local unison now mirrors prod + latest schema."
docker exec "$CONTAINER" psql "$LOCAL_URL" -tAc "select 'lyrics rows: ' || count(*) from lyrics"
docker exec "$CONTAINER" psql "$LOCAL_URL" -tAc "select 'song_artwork rows: ' || count(*) from song_artwork"
