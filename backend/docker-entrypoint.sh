#!/bin/sh
# Backend container entrypoint.
# Runs database migrations (retrying until MariaDB is reachable), then starts
# the API server. This lets `docker compose up -d` bring up a fully migrated
# stack with no manual steps.
set -e

# The container starts as root only to hand the uploads volume to the
# unprivileged "node" user (a volume from an older PRISM is root's), then runs
# everything as that user: a flaw in the app can't act as root in here.
if [ "$(id -u)" = "0" ]; then
  uploads="${UPLOAD_DIR:-/uploads}"
  mkdir -p "$uploads"
  if [ "$(stat -c %U "$uploads")" != "node" ]; then
    echo "[entrypoint] handing $uploads to the node user (once)..."
    chown -R node:node "$uploads" || echo "[entrypoint] warning: could not hand $uploads to the node user"
  fi
  exec su-exec node "$0" "$@"
fi

echo "[entrypoint] running database migrations..."

attempt=0
max_attempts=30
until npm run migrate; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "[entrypoint] migrations failed after ${max_attempts} attempts; exiting."
    exit 1
  fi
  echo "[entrypoint] migration attempt ${attempt} failed (database not ready?). retrying in 3s..."
  sleep 3
done

echo "[entrypoint] migrations complete. starting server."
exec node src/index.js
