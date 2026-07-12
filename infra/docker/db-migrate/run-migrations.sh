#!/bin/sh
set -eu

# Required: DATABASE_URL must be provided via Secrets Manager
: "${DATABASE_URL:?DATABASE_URL is required}"

# RDS enforces SSL (rds.force_ssl=1). Ensure the connection uses SSL.
# psql respects PGSSLMODE env var without modifying the connection string.
export PGSSLMODE="${PGSSLMODE:-require}"

echo "=== Applying migration: 20260712_01_user_administration.sql ==="

psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f /migrations/20260712_01_user_administration.sql

echo "=== Migration applied successfully ==="

# Validate schema
echo "=== Validating user_profiles columns ==="
psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -t \
  -c "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_profiles' ORDER BY ordinal_position;"

echo "=== Validating admin_audit_log table ==="
psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -t \
  -c "SELECT to_regclass('public.admin_audit_log');"

echo "=== Validation complete ==="
