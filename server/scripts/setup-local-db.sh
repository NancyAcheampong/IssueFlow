#!/usr/bin/env bash
set -euo pipefail

# Sets up (or repairs) both local Postgres databases this project needs -
# the dev database (issueflow) and the test database (issueflow_test) -
# both owned by a local `issueflow` role.
#
# Safe to re-run any time: every step checks before it acts, so re-running
# this after it already succeeded just confirms everything is still fine
# instead of erroring on "already exists". `set -euo pipefail` above means
# the *first* thing that goes wrong stops the whole script right there,
# with a clear message - not five confusing steps later.
#
# Usage (from anywhere in the repo):
#   bash server/scripts/setup-local-db.sh

cd "$(dirname "$0")/.."

DEV_URL="postgresql://issueflow:issueflow@localhost:5432/issueflow"
TEST_URL="postgresql://issueflow:issueflow@localhost:5432/issueflow_test"
ADMIN_URL="postgresql://issueflow:issueflow@localhost:5432/postgres"

echo "==> Checking Postgres is reachable and the 'issueflow' role exists..."
if ! psql "$ADMIN_URL" -c "SELECT 1;" > /dev/null 2>&1; then
  echo ""
  echo "FAILED: could not connect as the 'issueflow' role."
  echo "This almost always means either Postgres isn't running, or the role"
  echo "doesn't exist yet on whichever Postgres server is currently active"
  echo "at localhost:5432 (if you have more than one Postgres install, this"
  echo "can vary run to run - see server/README.md Troubleshooting)."
  echo ""
  echo "Fix, then re-run this script:"
  echo "  psql -h localhost -d postgres -c \"CREATE ROLE issueflow WITH LOGIN PASSWORD 'issueflow' CREATEDB;\""
  exit 1
fi
echo "    OK"

ensure_database() {
  local db_name="$1"
  local db_url="$2"

  echo "==> Ensuring '${db_name}' database exists..."
  if psql "$ADMIN_URL" -tAc "SELECT 1 FROM pg_database WHERE datname='${db_name}'" | grep -q 1; then
    echo "    already exists"
  else
    psql "$ADMIN_URL" -c "CREATE DATABASE ${db_name} OWNER issueflow;" > /dev/null
    echo "    created"
  fi

  # Postgres 15+ doesn't automatically give a database's OWNER rights on
  # its own `public` schema - that ownership comes from the template
  # database Postgres clones from, not from the OWNER clause above. This
  # grant is what we were missing the first few times around.
  psql "$db_url" -c "GRANT ALL ON SCHEMA public TO issueflow;" > /dev/null
  echo "    schema privileges confirmed"
}

ensure_database "issueflow" "$DEV_URL"
ensure_database "issueflow_test" "$TEST_URL"

echo "==> Applying migrations to the dev database..."
DATABASE_URL="${DEV_URL}?schema=public" npx prisma migrate deploy

echo "==> Applying migrations to the test database..."
DATABASE_URL="${TEST_URL}?schema=public" npx prisma migrate deploy

echo ""
echo "==> Final check: confirming both databases actually have the users table..."
psql "$DEV_URL" -c "\d users" > /dev/null && echo "    dev (issueflow): OK"
psql "$TEST_URL" -c "\d users" > /dev/null && echo "    test (issueflow_test): OK"

echo ""
echo "All set. Both databases exist, owned by 'issueflow', migrations applied."
