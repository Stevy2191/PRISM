#!/bin/sh
# Backend container entrypoint.
# Runs database migrations (retrying until MariaDB is reachable), then starts
# the API server. This lets `docker compose up -d` bring up a fully migrated
# stack with no manual steps.
set -e

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
