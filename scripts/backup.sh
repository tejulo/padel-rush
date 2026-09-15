#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

mkdir -p backups
stamp="$(date +%F-%H%M%S)"
file="backups/padel-rush-$stamp.dump"
temporary="$file.partial"

cleanup() {
  rm -f "$temporary"
}
trap cleanup EXIT

if command -v pg_dump >/dev/null 2>&1; then
  pg_dump -Fc "$DATABASE_URL" -f "$temporary"
  mv -n "$temporary" "$file"
else
  container_url="${COMPOSE_DATABASE_URL:-postgres://padel:padel@postgres:5432/padel_rush}"
  docker compose exec -T postgres pg_dump -Fc "$container_url" >"$temporary"
  mv -n "$temporary" "$file"
fi

if [[ ! -f "$file" ]]; then
  echo "Backup failed: $file was not written" >&2
  exit 1
fi

find backups -name 'padel-rush-*.dump' -mtime +30 -delete
echo "Backup written to $file"
