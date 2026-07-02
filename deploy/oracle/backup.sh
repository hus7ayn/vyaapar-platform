#!/usr/bin/env bash
# Daily backup — add to cron: 0 2 * * * /home/ubuntu/vyaapar/deploy/oracle/backup.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
BACKUP_DIR="${BACKUP_DIR:-$HOME/vyaapar-backups}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M)"
FILE="$BACKUP_DIR/nexus_platform-$STAMP.sql"

docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U nexus nexus_platform > "$FILE"

gzip -f "$FILE"
echo "Backup saved: ${FILE}.gz"
# Keep last 14 days
find "$BACKUP_DIR" -name 'nexus_platform-*.sql.gz' -mtime +14 -delete 2>/dev/null || true
