#!/bin/bash
##
## Agentic EHR — Automated SQLite Backup Script
##
## Usage:
##   ./scripts/backup.sh                  # Manual run
##   crontab: 0 2 * * * /path/to/backup.sh   # Daily at 2 AM
##
## Creates timestamped backups, validates integrity, prunes old copies.
##

set -euo pipefail

# ---- Configuration ----
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_PATH="${DATABASE_PATH:-$PROJECT_DIR/data/mjr-ehr.db}"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP="$(date +%Y-%m-%d_%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/ehr-backup-$TIMESTAMP.db"

# ---- Preflight ----
if [ ! -f "$DB_PATH" ]; then
  echo "[ERROR] Database not found: $DB_PATH"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# ---- Checkpoint WAL (flush pending writes) ----
echo "[BACKUP] Checkpointing WAL..."
sqlite3 "$DB_PATH" "PRAGMA wal_checkpoint(RESTART);" 2>/dev/null || true

# ---- Backup using SQLite .backup (atomic, safe during writes) ----
echo "[BACKUP] Creating backup: $BACKUP_FILE"
sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"

# ---- Integrity check on backup ----
echo "[BACKUP] Verifying integrity..."
RESULT=$(sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;" 2>&1)
if [ "$RESULT" != "ok" ]; then
  echo "[ERROR] Backup integrity check FAILED: $RESULT"
  rm -f "$BACKUP_FILE"
  exit 1
fi

# ---- Record size ----
SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[BACKUP] Backup complete: $BACKUP_FILE ($SIZE)"

# ---- Prune old backups ----
PRUNED=$(find "$BACKUP_DIR" -name "ehr-backup-*.db" -mtime +"$RETENTION_DAYS" -print -delete | wc -l)
if [ "$PRUNED" -gt 0 ]; then
  echo "[BACKUP] Pruned $PRUNED backup(s) older than $RETENTION_DAYS days"
fi

# ---- Optional: Upload to S3 ----
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  echo "[BACKUP] Uploading to S3: s3://$BACKUP_S3_BUCKET/ehr-backups/"
  aws s3 cp "$BACKUP_FILE" "s3://$BACKUP_S3_BUCKET/ehr-backups/" --quiet
  echo "[BACKUP] S3 upload complete"
fi

echo "[BACKUP] Done."
