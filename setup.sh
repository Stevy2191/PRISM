#!/usr/bin/env bash
# PRISM interactive setup — checks prerequisites, collects the minimum required
# input, writes .env, pulls images, starts containers, and confirms the app is up.

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

info()    { echo -e "${CYAN}${BOLD}==>${RESET} $*"; }
success() { echo -e "${GREEN}${BOLD}  ✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}${BOLD}  !${RESET} $*"; }
die()     { echo -e "${RED}${BOLD}  ✗ ERROR:${RESET} $*" >&2; exit 1; }

gen_secret() {
  openssl rand -hex 32 2>/dev/null \
    || head -c 32 /dev/urandom | xxd -p 2>/dev/null | tr -d '\n' \
    || date +%s%N | sha256sum | cut -c1-64
}

gen_password() {
  openssl rand -hex 10 2>/dev/null \
    || head -c 10 /dev/urandom | xxd -p 2>/dev/null | tr -d '\n' | cut -c1-20
}

# Returns success (0) if something is already listening on the given TCP port
# on this host. Tries the most reliable tool available, falling back to
# bash's own /dev/tcp so it still works with none of ss/lsof/nc installed.
port_in_use() {
  local port="$1"
  if command -v ss &>/dev/null; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[.:]${port}\$"
  elif command -v lsof &>/dev/null; then
    lsof -iTCP:"${port}" -sTCP:LISTEN &>/dev/null
  elif command -v nc &>/dev/null; then
    nc -z 127.0.0.1 "${port}" &>/dev/null
  else
    (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null && exec 3<&- 3>&-
  fi
}

# Prompts for a host port, re-prompting until the entered value is a valid,
# free TCP port. Sets the global APP_PORT. $1 is the default/current port
# shown in the prompt.
choose_app_port() {
  local default_port="$1"
  local prompt="  Host port to serve PRISM on [${default_port}]: "
  local input port
  while true; do
    read -r -p "$prompt" input
    port="${input:-$default_port}"
    if ! [[ "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
      warn "\"${port}\" is not a valid port number (1-65535)."
      prompt="  Host port to serve PRISM on: "
      continue
    fi
    if port_in_use "$port"; then
      warn "Port ${port} is already in use on this machine."
      prompt="  Enter a different host port to use: "
      continue
    fi
    APP_PORT="$port"
    break
  done
}

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}${CYAN}╔═══════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║        PRISM  Setup           ║${RESET}"
echo -e "${BOLD}${CYAN}╚═══════════════════════════════╝${RESET}"
echo ""

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------
info "Checking prerequisites..."

if ! command -v docker &>/dev/null; then
  die "Docker is not installed. Install it from https://docs.docker.com/get-docker/ and re-run this script."
fi
success "Docker found: $(docker --version)"

if docker compose version &>/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE="docker-compose"
else
  die "Docker Compose is not installed. Install it from https://docs.docker.com/compose/install/ and re-run this script."
fi
success "Docker Compose found (using: ${COMPOSE})"

echo ""

# ---------------------------------------------------------------------------
# .env handling
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

SKIP_CONFIG=false
if [[ -f "$ENV_FILE" ]]; then
  warn ".env already exists."
  read -r -p "  Overwrite it with new settings? [y/N] " OVERWRITE
  if [[ ! "$OVERWRITE" =~ ^[Yy]$ ]]; then
    info "Keeping existing .env — skipping configuration."
    SKIP_CONFIG=true
  fi
fi

BOOTSTRAP_USERNAME="admin"
BOOTSTRAP_PASSWORD=""
GENERATED_PASSWORD=false
CONFIGURE_LDAP=false
APP_PORT="8080"

if [[ "$SKIP_CONFIG" == false ]]; then
  info "Configuring PRISM..."
  echo ""

  # Admin username
  read -r -p "  Admin username [admin]: " BOOTSTRAP_USERNAME
  BOOTSTRAP_USERNAME="${BOOTSTRAP_USERNAME:-admin}"

  # Admin password
  echo "  Admin password — press Enter to auto-generate a secure random one."
  read -r -s -p "  Password [auto-generate]: " BOOTSTRAP_PASSWORD
  echo ""
  if [[ -z "$BOOTSTRAP_PASSWORD" ]]; then
    BOOTSTRAP_PASSWORD="$(gen_password)"
    GENERATED_PASSWORD=true
    echo "    → Password will be auto-generated."
  fi

  # Host port
  echo ""
  choose_app_port "8080"

  # LDAP / Active Directory
  echo ""
  read -r -p "  Do you use Active Directory / LDAP for authentication? [y/N] " USE_LDAP
  if [[ "$USE_LDAP" =~ ^[Yy]$ ]]; then
    CONFIGURE_LDAP=true
    echo ""
    read -r -p "  LDAP URL (e.g. ldap://dc01.domain.local): " LDAP_URL
    read -r -p "  Base DN (e.g. DC=domain,DC=local): " LDAP_BASE_DN
    read -r -p "  Bind DN (e.g. CN=svc-prism,OU=Service Accounts,DC=domain,DC=local): " LDAP_BIND_DN
    read -r -s -p "  Bind password: " LDAP_BIND_PASSWORD
    echo ""
    read -r -p "  User filter [(sAMAccountName={{username}})]: " LDAP_USER_FILTER
    LDAP_USER_FILTER="${LDAP_USER_FILTER:-(sAMAccountName={{username}})}"
  else
    LDAP_URL="ldap://placeholder.example.local"
    LDAP_BASE_DN="DC=placeholder,DC=local"
    LDAP_BIND_DN="CN=placeholder,DC=placeholder,DC=local"
    LDAP_BIND_PASSWORD="placeholder"
    LDAP_USER_FILTER="(sAMAccountName={{username}})"
  fi

  # Generate secrets
  echo ""
  info "Generating database credentials and session secret..."
  DB_PASSWORD="$(gen_secret)"
  DB_ROOT_PASSWORD="$(gen_secret)"
  SESSION_SECRET="$(gen_secret)"
  # Separate from SESSION_SECRET so the session secret can be rotated later
  # without making stored credentials (LDAP bind password, license keys,
  # calendar tokens) undecryptable.
  ENCRYPTION_KEY="$(gen_secret)"
  success "Secrets generated."

  # Write .env
  cat > "$ENV_FILE" <<ENVEOF
# PRISM environment — generated by setup.sh on $(date -u '+%Y-%m-%dT%H:%M:%SZ')

DB_HOST=mariadb
DB_PORT=3306
DB_NAME=prism
DB_USER=prism
DB_PASSWORD=${DB_PASSWORD}

# LDAP / Active Directory
# Set LDAP_ENABLED=true and fill in the variables below to enable AD auth.
# When false the backend only authenticates local accounts.
LDAP_ENABLED=${CONFIGURE_LDAP}
LDAP_URL=${LDAP_URL}
LDAP_BASE_DN=${LDAP_BASE_DN}
LDAP_BIND_DN=${LDAP_BIND_DN}
LDAP_BIND_PASSWORD=${LDAP_BIND_PASSWORD}
LDAP_USER_FILTER=${LDAP_USER_FILTER}

SESSION_SECRET=${SESSION_SECRET}

# Encrypts credentials stored in the database. Keep this backed up: losing it
# means re-entering the LDAP bind password and any stored license keys.
ENCRYPTION_KEY=${ENCRYPTION_KEY}

NODE_ENV=production

# MariaDB root password (used by the mariadb container only)
DB_ROOT_PASSWORD=${DB_ROOT_PASSWORD}

# Bootstrap admin — created automatically on first startup if the username
# does not already exist.
BOOTSTRAP_LOCAL_USERNAME=${BOOTSTRAP_USERNAME}
BOOTSTRAP_LOCAL_PASSWORD=${BOOTSTRAP_PASSWORD}

UPLOAD_DIR=/uploads

# Host port PRISM is served on. Change this if port 80 is already in use.
APP_PORT=${APP_PORT}
COOKIE_SECURE=false
ENVEOF

  success ".env written."
fi

# When keeping an existing .env, read APP_PORT from it so the health check and
# summary URL reflect the actual configured port.
if [[ "$SKIP_CONFIG" == true ]]; then
  APP_PORT="$(grep -E '^APP_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')"
  APP_PORT="${APP_PORT:-80}"

  if port_in_use "$APP_PORT"; then
    warn "Port ${APP_PORT} (from existing .env) is already in use on this machine."
    choose_app_port "$APP_PORT"
    sed -i.bak -E "s/^APP_PORT=.*/APP_PORT=${APP_PORT}/" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
    success "Updated .env with APP_PORT=${APP_PORT}."
  fi
fi

echo ""

# ---------------------------------------------------------------------------
# Pull images
# ---------------------------------------------------------------------------
info "Pulling latest images from GitHub Container Registry..."
echo ""
$COMPOSE pull
echo ""
success "Images up to date."

echo ""

# ---------------------------------------------------------------------------
# Start containers
# ---------------------------------------------------------------------------
info "Starting PRISM (database, backend, frontend)..."
echo ""
$COMPOSE up -d
echo ""
success "Containers started."

echo ""

# ---------------------------------------------------------------------------
# Wait for health check
# ---------------------------------------------------------------------------
info "Waiting for PRISM to be ready (up to 120 seconds)..."
READY=false
for i in $(seq 1 24); do
  if curl -sf "http://localhost:${APP_PORT}/api/v1/health" >/dev/null 2>&1; then
    READY=true
    break
  fi
  printf "  ."
  sleep 5
done
echo ""

if [[ "$READY" == false ]]; then
  warn "The app did not respond within 120 seconds."
  warn "Showing recent log output — check for errors:"
  echo ""
  $COMPOSE logs --tail=20
  echo ""
  echo -e "  Continue watching: ${CYAN}${COMPOSE} logs -f${RESET}"
  echo -e "  Health endpoint:   ${CYAN}curl http://localhost:${APP_PORT}/api/v1/health${RESET}"
  exit 1
fi

success "PRISM is live!"

# ---------------------------------------------------------------------------
# Brief log tail
# ---------------------------------------------------------------------------
echo ""
info "Last 10 log lines:"
$COMPOSE logs --tail=10

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║        PRISM is ready!               ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}URL:${RESET}       http://localhost:${APP_PORT}"
echo -e "  ${BOLD}Login tab:${RESET} Local Account"

if [[ "$SKIP_CONFIG" == false ]]; then
  echo -e "  ${BOLD}Username:${RESET}  ${BOOTSTRAP_USERNAME}"
  if [[ "$GENERATED_PASSWORD" == true ]]; then
    echo -e "  ${BOLD}Password:${RESET}  ${BOLD}${RED}${BOOTSTRAP_PASSWORD}${RESET}  ← save this now, it won't be shown again!"
  else
    echo -e "  ${BOLD}Password:${RESET}  (the password you entered)"
  fi
  if [[ "$CONFIGURE_LDAP" == false ]]; then
    echo ""
    echo -e "  ${YELLOW}Active Directory is not configured.${RESET}"
    echo -e "  Only the Local Account login tab will work."
    echo -e "  To enable AD later, edit .env and fill in the LDAP_* variables, then restart:"
    echo -e "  ${CYAN}${COMPOSE} up -d${RESET}"
  fi
fi

echo ""
echo -e "  Stop PRISM:   ${CYAN}${COMPOSE} down${RESET}"
echo -e "  View logs:    ${CYAN}${COMPOSE} logs -f${RESET}"
echo -e "  Update:       ${CYAN}${COMPOSE} pull && ${COMPOSE} up -d${RESET}"
echo ""
