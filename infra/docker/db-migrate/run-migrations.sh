#!/bin/sh
set -eu

# Required: DATABASE_URL must be provided via Secrets Manager
: "${DATABASE_URL:?DATABASE_URL is required}"

# RDS enforces SSL (rds.force_ssl=1). Ensure the connection uses SSL.
# psql respects PGSSLMODE env var without modifying the connection string.
export PGSSLMODE="${PGSSLMODE:-require}"

# Tracking table so each migration runs exactly once, in lexical order.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

# Baseline: migrations up to 20260712 were applied to staging manually
# (before this runner existed — the old image only applied
# 20260712_01_user_administration.sql). Files <= 20260712 that are not
# yet tracked are marked as applied WITHOUT running, because their
# schema is already live and most are NOT idempotent (bare ADD COLUMN /
# CREATE TABLE). Anything after 20260712 is new and gets executed.
APPLIED=0
for FILE in /migrations/*.sql; do
  [ -e "$FILE" ] || continue
  NAME=$(basename "$FILE")

  ALREADY=$(psql "$DATABASE_URL" -t -A -c \
    "SELECT count(*) FROM public.schema_migrations WHERE filename = '$NAME';")
  if [ "$ALREADY" != "0" ]; then
    echo "=== Skip (already applied): $NAME ==="
    continue
  fi

  if [ "$NAME" \< "20260713" ]; then
    echo "=== Baseline (schema already live, marking applied): $NAME ==="
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
      "INSERT INTO public.schema_migrations (filename) VALUES ('$NAME');"
    continue
  fi

  echo "=== Applying migration: $NAME ==="
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$FILE"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
    "INSERT INTO public.schema_migrations (filename) VALUES ('$NAME');"
  APPLIED=$((APPLIED + 1))
done

echo "=== Migrations complete ($APPLIED newly applied) ==="

# Post-apply sanity check: key tables exist.
echo "=== Validating core tables ==="
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -c \
  "SELECT to_regclass('public.admin_audit_log'), to_regclass('public.analysis_jobs'), to_regclass('public.analysis_job_checkpoints');"

echo "=== Validation complete ==="
