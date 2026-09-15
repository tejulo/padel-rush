#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

mkdir -p backups
file="backups/padel-rush-$(date +%F-%H%M).dump"

if command -v pg_dump >/dev/null 2>&1; then
  pg_dump -Fc "$DATABASE_URL" -f "$file"
else
  docker compose exec -T postgres pg_dump -Fc -U padel -d padel_rush >"$file"
fi

find backups -name 'padel-rush-*.dump' -mtime +30 -delete
echo "Backup written to $file"
