#!/usr/bin/env bash
# One-time set-up of the layout check tool. Safe to run again.
#
# It only ever talks to the local Postgres server, as the postgres system user
# (the same way tests/db-bootstrap.sh does). It:
#   1. starts the local Postgres cluster when it is down;
#   2. writes the local settings file (tests/layout-check/out/settings.env,
#      mode 600) with a database password, a sign-in password and an encryption
#      key that are made up here, on this machine. An existing file is kept;
#   3. makes the login role and the database named in that file (default
#      recrm_layout_check; the name must start with recrm_layout);
#   4. creates the app's tables in that database (scripts/db-migrate.mjs).
#
#   bash tests/layout-check/setup.sh         set up, or repair, the database and the settings file
#   bash tests/layout-check/setup.sh drop    remove the database, its role and the settings file
#
# Options (environment):
#   LAYOUT_CHECK_OUT         output folder (default tests/layout-check/out)
#   LAYOUT_CHECK_SETTINGS    settings file (default <output folder>/settings.env)
#   LAYOUT_CHECK_DB          database and role name, for a new settings file (default recrm_layout_check)
#   LAYOUT_CHECK_STUB_PORT   port of the sign-in stub, for a new settings file (default 54400)
#   LAYOUT_CHECK_EMAIL       made-up sign-in email, for a new settings file (default owner.demo@example.com)
#   PG_VERSION, PG_CLUSTER   the local Postgres cluster (default 16 main)
#
# This is not the test database: never run "npm test" against this database,
# and never put the test database (recrm_test) in the settings file.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="${LAYOUT_CHECK_OUT:-$HERE/out}"
SETTINGS="${LAYOUT_CHECK_SETTINGS:-$OUT/settings.env}"
PG_VERSION="${PG_VERSION:-16}"
PG_CLUSTER="${PG_CLUSTER:-main}"
ACTION="${1:-setup}"
NAME_RE='^recrm_layout[a-z0-9_]*$'

fail() {
  echo "$*" >&2
  exit 1
}

as_postgres() {
  if [ "$(id -u)" = "0" ]; then
    su postgres -c "$1"
  else
    sudo -u postgres sh -c "$1"
  fi
}

# One value from the settings file. The file is read as text and never run.
setting() {
  { grep -E "^$1=" "$SETTINGS" || true; } | head -n 1 | cut -d= -f2-
}

# Sets DB_NAME, DB_PASSWORD and DB_PORT from the settings file. Never prints them.
read_settings() {
  local url re='^postgres://([a-z0-9_]+):([0-9a-f]+)@127\.0\.0\.1:([0-9]+)/([a-z0-9_]+)$'
  url="$(setting DATABASE_URL)"
  if ! [[ "$url" =~ $re ]]; then
    fail "The settings file $SETTINGS was not made by this script (its DATABASE_URL has another shape). Move it away and run the set-up again."
  fi
  DB_PASSWORD="${BASH_REMATCH[2]}"
  DB_PORT="${BASH_REMATCH[3]}"
  DB_NAME="${BASH_REMATCH[4]}"
  [ "${BASH_REMATCH[1]}" = "$DB_NAME" ] || fail "The settings file $SETTINGS was not made by this script (the role and the database have different names)."
  [[ "$DB_NAME" =~ $NAME_RE ]] || fail "Refusing: the database in $SETTINGS is not a layout check database (its name must start with recrm_layout)."
}

random() {
  node -e 'const c = require("node:crypto"); const [kind] = process.argv.slice(1);
    process.stdout.write(kind === "uuid" ? c.randomUUID() : kind === "key" ? c.randomBytes(32).toString("base64") : c.randomBytes(24).toString("hex"));' "$1"
}

case "$ACTION" in
  setup | drop) ;;
  *) fail "Usage: bash tests/layout-check/setup.sh [drop]" ;;
esac

command -v node >/dev/null || fail "node was not found."
if ! command -v pg_lsclusters >/dev/null || ! command -v pg_ctlcluster >/dev/null; then
  fail "This script needs a local Postgres installed the Debian way (pg_lsclusters, pg_ctlcluster), as in Claude cloud sessions. On another machine, make a local database whose name starts with recrm_layout by hand, and write $SETTINGS from tests/layout-check/settings.example.env."
fi

CLUSTER_PORT="$(pg_lsclusters -h | awk -v v="$PG_VERSION" -v c="$PG_CLUSTER" '$1==v && $2==c {print $3}')"
[ -n "$CLUSTER_PORT" ] || fail "There is no local Postgres cluster $PG_VERSION/$PG_CLUSTER (see pg_lsclusters)."

if ! pg_lsclusters -h | awk -v v="$PG_VERSION" -v c="$PG_CLUSTER" '$1==v && $2==c {print $4}' | grep -q online; then
  echo "Starting Postgres cluster $PG_VERSION/$PG_CLUSTER"
  pg_ctlcluster "$PG_VERSION" "$PG_CLUSTER" start
fi
for _ in $(seq 1 30); do
  if as_postgres "psql -p $CLUSTER_PORT -qAtc 'select 1'" >/dev/null 2>&1; then break; fi
  sleep 1
done
as_postgres "psql -p $CLUSTER_PORT -qAtc 'select 1'" >/dev/null 2>&1 || fail "The local Postgres server did not answer."

if [ "$ACTION" = "drop" ]; then
  if [ ! -f "$SETTINGS" ]; then
    echo "There is no settings file at $SETTINGS, so there is nothing to drop."
    exit 0
  fi
  read_settings
  [ "$DB_PORT" = "$CLUSTER_PORT" ] || fail "The settings file names port $DB_PORT, but the local cluster $PG_VERSION/$PG_CLUSTER is on port $CLUSTER_PORT. Nothing was dropped."
  echo "Dropping the local database $DB_NAME and its role (stop the app servers of this tool first)"
  as_postgres "psql -p $CLUSTER_PORT -v ON_ERROR_STOP=1 -q" <<SQL
DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE);
DROP ROLE IF EXISTS $DB_NAME;
SQL
  rm -f "$SETTINGS"
  echo "Done. The settings file is removed. Pictures, reports and logs in $OUT were kept."
  exit 0
fi

if [ -f "$SETTINGS" ]; then
  read_settings
  [ "$DB_PORT" = "$CLUSTER_PORT" ] || fail "The settings file names port $DB_PORT, but the local cluster $PG_VERSION/$PG_CLUSTER is on port $CLUSTER_PORT."
  if [ -n "${LAYOUT_CHECK_DB:-}" ] && [ "$LAYOUT_CHECK_DB" != "$DB_NAME" ]; then
    fail "The settings file $SETTINGS is for the database $DB_NAME, not $LAYOUT_CHECK_DB. Use another output folder (LAYOUT_CHECK_OUT), or run: bash tests/layout-check/setup.sh drop"
  fi
  echo "Keeping the settings file $SETTINGS"
else
  DB_NAME="${LAYOUT_CHECK_DB:-recrm_layout_check}"
  [[ "$DB_NAME" =~ $NAME_RE ]] || fail "LAYOUT_CHECK_DB must start with recrm_layout and use only a-z, 0-9 and _ (got $DB_NAME)."
  STUB_PORT="${LAYOUT_CHECK_STUB_PORT:-54400}"
  if ! [[ "$STUB_PORT" =~ ^[0-9]+$ ]] || [ "$STUB_PORT" -lt 1024 ] || [ "$STUB_PORT" -gt 65535 ]; then
    fail "LAYOUT_CHECK_STUB_PORT must be a port number from 1024 to 65535 (got $STUB_PORT)."
  fi
  EMAIL="${LAYOUT_CHECK_EMAIL:-owner.demo@example.com}"
  [[ "$EMAIL" =~ ^[a-z0-9._-]+@[a-z0-9.-]+$ ]] || fail "LAYOUT_CHECK_EMAIL must be a plain lower-case email address (a made-up one, for example on example.com)."
  DB_PORT="$CLUSTER_PORT"
  DB_PASSWORD="$(random hex)"
  ENCRYPTION_KEY="$(random key)"
  USER_ID="$(random uuid)"
  USER_PASSWORD="$(random hex)"
  if [ -z "$DB_PASSWORD" ] || [ -z "$ENCRYPTION_KEY" ] || [ -z "$USER_ID" ] || [ -z "$USER_PASSWORD" ]; then
    fail "Could not make up the local passwords."
  fi
  umask 077
  mkdir -p "$(dirname "$SETTINGS")"
  cat >"$SETTINGS" <<EOF
# Local settings of the layout check tool, written by tests/layout-check/setup.sh.
# The two passwords and the key were made up on this machine. Never commit this file.
DATABASE_URL=postgres://$DB_NAME:$DB_PASSWORD@127.0.0.1:$DB_PORT/$DB_NAME
AUTH_STUB_PORT=$STUB_PORT
SETTINGS_ENCRYPTION_KEY=$ENCRYPTION_KEY
DEMO_USER_ID=$USER_ID
DEMO_USER_EMAIL=$EMAIL
DEMO_USER_PASSWORD=$USER_PASSWORD
EOF
  chmod 600 "$SETTINGS"
  echo "Wrote the settings file $SETTINGS"
fi

# The name is checked above (a-z, 0-9 and _ only) and the password is hex, so
# both are safe inside the statements. The password goes in on standard input,
# so it never shows in a process list.
as_postgres "psql -p $CLUSTER_PORT -v ON_ERROR_STOP=1 -q" <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DB_NAME') THEN
    CREATE ROLE $DB_NAME LOGIN PASSWORD '$DB_PASSWORD';
  ELSE
    ALTER ROLE $DB_NAME LOGIN PASSWORD '$DB_PASSWORD';
  END IF;
END
\$\$;
SQL
if ! as_postgres "psql -p $CLUSTER_PORT -qAtc \"select 1 from pg_database where datname = '$DB_NAME'\"" | grep -q 1; then
  as_postgres "createdb -p $CLUSTER_PORT -O $DB_NAME $DB_NAME"
  echo "Created the local database $DB_NAME"
fi

echo "Creating or updating the app's tables in $DB_NAME"
(cd "$ROOT" && DATABASE_URL="postgres://$DB_NAME:$DB_PASSWORD@127.0.0.1:$DB_PORT/$DB_NAME" node scripts/db-migrate.mjs)

echo
echo "The layout check is set up."
echo "  database:      127.0.0.1:$DB_PORT/$DB_NAME (local, made for this tool)"
echo "  settings file: $SETTINGS (never commit it)"
echo "  sign-in user:  $(setting DEMO_USER_EMAIL) (its password is in the settings file)"
echo "Next: node tests/layout-check/seed.mjs"
