#!/usr/bin/env bash
# Local test database bootstrap.
#
# Starts the local Postgres 16 cluster (Debian "16/main") and creates:
#   - the login role recrm_test (password recrm_test)
#   - the database recrm_test, owned by recrm_test
#   - the NOLOGIN roles anon, authenticated and service_role, which mirror the
#     roles Supabase uses for its public REST API. recrm_test is made a member
#     of them so the tests can "SET ROLE anon" and check what that role can do.
#
# Safe to run more than once. It only ever talks to the local server.
# Postgres refuses to run as root, so the server commands run as the postgres
# system user. Run it with: bash tests/db-bootstrap.sh
set -euo pipefail

PG_VERSION="${PG_VERSION:-16}"
PG_CLUSTER="${PG_CLUSTER:-main}"

as_postgres() {
  if [ "$(id -u)" = "0" ]; then
    su postgres -c "$1"
  else
    sudo -u postgres sh -c "$1"
  fi
}

if ! pg_lsclusters -h | awk -v v="$PG_VERSION" -v c="$PG_CLUSTER" '$1==v && $2==c {print $4}' | grep -q online; then
  echo "Starting Postgres cluster $PG_VERSION/$PG_CLUSTER"
  pg_ctlcluster "$PG_VERSION" "$PG_CLUSTER" start
fi

for i in $(seq 1 30); do
  if as_postgres "psql -qAtc 'select 1'" >/dev/null 2>&1; then break; fi
  sleep 1
done

as_postgres "psql -v ON_ERROR_STOP=1 -q" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recrm_test') THEN
    CREATE ROLE recrm_test LOGIN PASSWORD 'recrm_test';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;
GRANT anon, authenticated, service_role TO recrm_test;
SQL

if ! as_postgres "psql -qAtc \"select 1 from pg_database where datname = 'recrm_test'\"" | grep -q 1; then
  as_postgres "createdb -O recrm_test recrm_test"
fi

echo "Local test database ready: postgres://recrm_test:recrm_test@127.0.0.1:5432/recrm_test"
