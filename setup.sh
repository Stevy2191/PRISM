#!/usr/bin/env bash
# PRISM interactive setup — checks prerequisites, collects the minimum required
# input, writes .env, pulls images, starts containers, and confirms the app is up.
#
# Which images a new .env runs: latest (released code) unless you say otherwise,
#   IMAGE_TAG=dev ./setup.sh      # the dev branch, for a test instance

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
# free TCP port. $1 is the variable to set, $2 the default shown in the
# prompt, $3 what the port is for.
choose_port() {
  local var="$1" default_port="$2" what="$3"
  local prompt="  ${what} [${default_port}]: "
  local input port
  while true; do
    read -r -p "$prompt" input
    port="${input:-$default_port}"
    if ! [[ "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
      warn "\"${port}\" is not a valid port number (1-65535)."
      prompt="  ${what}: "
      continue
    fi
    if port_in_use "$port"; then
      warn "Port ${port} is already in use on this machine."
      prompt="  Enter a different host port to use: "
      continue
    fi
    printf -v "$var" '%s' "$port"
    break
  done
}

choose_app_port() { choose_port APP_PORT "$1" "Host port to serve PRISM on"; }

# Reads KEY from .env (the last value, quotes and spaces trimmed).
env_get() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "[:space:]\"'" || true
}

# Sets KEY=VALUE in .env, replacing the line if it's there, appending if not.
env_set() {
  local tmp
  tmp="$(mktemp)"
  awk -v k="$1" -v v="$2" 'BEGIN{done=0} $0 ~ "^"k"=" {print k"="v; done=1; next} {print} END{if(!done) print k"="v}' \
    "$ENV_FILE" > "$tmp"
  cat "$tmp" > "$ENV_FILE" && rm -f "$tmp"
}

# This machine's address on the local network, best guess (may be empty).
lan_ip() {
  local ip=""
  if command -v ip &>/dev/null; then
    ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="src"){print $(i+1); exit}}')"
  fi
  if [[ -z "$ip" ]] && command -v hostname &>/dev/null; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')" || true
  fi
  if [[ -z "$ip" ]] && command -v ipconfig &>/dev/null; then
    ip="$(ipconfig getifaddr en0 2>/dev/null)" || true
  fi
  echo "$ip"
}

# ---------------------------------------------------------------------------
# Test certificate (HTTPS for testing). setup.sh makes a small certificate
# authority of its own and signs PRISM's certificate with it, so each test
# computer trusts one file (certs/prism-test-ca.crt) once, and keeps trusting
# it when the server certificate is renewed. The authority may only sign
# PRISM's own names (a name constraint), so a computer that trusts it doesn't
# trust it for any other site. Its private key stays in .prism-test-ca/ on
# this host and never goes into a container.
# ---------------------------------------------------------------------------
CERT_DIR="certs"
CA_DIR=".prism-test-ca"

# "192.168.1.50,prism.lan" -> "IP:192.168.1.50,DNS:prism.lan", plus localhost.
san_list() {
  local out="DNS:localhost,IP:127.0.0.1" name
  local IFS=','
  for name in $1; do
    [[ "$name" == "localhost" || "$name" == "127.0.0.1" ]] && continue
    if [[ "$name" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then out="IP:${name},${out}"; else out="DNS:${name},${out}"; fi
  done
  echo "$out"
}

# The same names as a name constraint: IP:a.b.c.d/255.255.255.255 for IPs.
permitted_list() {
  local out="" entry
  local IFS=','
  for entry in $(san_list "$1"); do
    if [[ "$entry" == IP:* ]]; then entry="${entry}/255.255.255.255"; fi
    out="${out:+${out},}permitted;${entry}"
  done
  echo "$out"
}

# Makes the authority if there isn't one for exactly these names. Prints
# "first" when it made the first one, "new" when it replaced one (computers
# that trusted the old one must trust it again), "kept" otherwise.
ensure_test_ca() {
  local names="$1" conf
  if [[ -f "${CA_DIR}/ca.key" && -f "${CA_DIR}/ca.crt" && "$(cat "${CA_DIR}/names" 2>/dev/null)" == "$names" ]] \
     && openssl x509 -checkend 2592000 -noout -in "${CA_DIR}/ca.crt" &>/dev/null; then
    echo kept; return
  fi
  local made=first
  [[ -f "${CA_DIR}/ca.crt" ]] && made=new
  mkdir -p "$CA_DIR" && chmod 700 "$CA_DIR"
  conf="$(mktemp)"
  cat > "$conf" <<CONFEOF
[req]
distinguished_name = dn
prompt = no
[dn]
CN = PRISM test CA ($(hostname 2>/dev/null || echo prism)) $(date -u +%Y-%m-%d)
O = PRISM (testing only)
[ext]
basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
nameConstraints = critical,$(permitted_list "$names")
CONFEOF
  (umask 077 && openssl ecparam -name prime256v1 -genkey -noout -out "${CA_DIR}/ca.key") >/dev/null 2>&1
  openssl req -x509 -new -key "${CA_DIR}/ca.key" -sha256 -days 3650 -config "$conf" -extensions ext \
    -out "${CA_DIR}/ca.crt" >/dev/null 2>&1
  rm -f "$conf"
  echo "$names" > "${CA_DIR}/names"
  echo "$made"
}

# Signs a server certificate for the names (825 days, the most Apple allows)
# and puts it, its key and the authority's certificate in certs/.
issue_server_cert() {
  local names="$1" first="${1%%,*}" conf csr
  mkdir -p "$CERT_DIR"
  conf="$(mktemp)"; csr="$(mktemp)"
  cat > "$conf" <<CONFEOF
[req]
distinguished_name = dn
prompt = no
[dn]
CN = ${first}
O = PRISM (testing only)
[ext]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = $(san_list "$names")
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
CONFEOF
  (umask 077 && openssl ecparam -name prime256v1 -genkey -noout -out "${CERT_DIR}/server.key") >/dev/null 2>&1
  openssl req -new -key "${CERT_DIR}/server.key" -config "$conf" -out "$csr" >/dev/null 2>&1
  openssl x509 -req -in "$csr" -CA "${CA_DIR}/ca.crt" -CAkey "${CA_DIR}/ca.key" \
    -set_serial "0x$(openssl rand -hex 16)" -days 825 -sha256 -extfile "$conf" -extensions ext \
    -out "${CERT_DIR}/server.crt" >/dev/null 2>&1
  rm -f "$conf" "$csr"
  cp "${CA_DIR}/ca.crt" "${CERT_DIR}/prism-test-ca.crt"
  chmod 644 "${CERT_DIR}/server.crt" "${CERT_DIR}/prism-test-ca.crt"
  openssl verify -CAfile "${CA_DIR}/ca.crt" "${CERT_DIR}/server.crt" >/dev/null 2>&1 \
    || die "The test certificate didn't verify. Check that openssl works, then re-run setup.sh."
}

# Makes or renews what's needed. Prints what happened to the authority.
ensure_test_cert() {
  local names="$1" ca
  ca="$(ensure_test_ca "$names")"
  if [[ "$ca" != kept ]] || [[ ! -f "${CERT_DIR}/server.crt" ]] \
     || ! openssl x509 -checkend 2592000 -noout -in "${CERT_DIR}/server.crt" &>/dev/null \
     || ! openssl verify -CAfile "${CA_DIR}/ca.crt" "${CERT_DIR}/server.crt" &>/dev/null; then
    issue_server_cert "$names"
  fi
  echo "$ca"
}

# Asks whether to turn HTTPS on, and for the port and names. Sets TLS_NAMES
# and HTTPS_PORT, and returns 1 if the answer is no.
# How people will reach PRISM: sets ACCESS_MODE to proxy (their own HTTPS
# reverse proxy), test (HTTPS with a test certificate from this script) or
# http (plain HTTP on this network). PUBLIC_APP_URL — the address in emailed
# links, single sign-on and the agent's portal link — follows from it.
ask_access_mode() {
  local answer
  echo ""
  echo "  How will people reach PRISM?"
  echo "    1) Through my own reverse proxy that serves it over HTTPS"
  echo "       (e.g. https://helpdesk.example.com). Recommended."
  echo "    2) HTTPS with a test certificate made by this setup. For testing:"
  echo "       each computer must trust the test certificate, and Microsoft 365"
  echo "       sign-in still needs a real one."
  echo "    3) Plain HTTP on this network. For a quick look only: the PRISM agent"
  echo "       and secure sign-in need HTTPS."
  while true; do
    read -r -p "  Choose 1, 2 or 3 [1]: " answer
    case "${answer:-1}" in
      1) ACCESS_MODE=proxy; return ;;
      2) ACCESS_MODE=test; return ;;
      3) ACCESS_MODE=http; return ;;
      *) warn "Enter 1, 2 or 3." ;;
    esac
  done
}

# The proxy's address, https:// with an optional port and no path.
ask_proxy_url() {
  local input
  echo "  The address people type to reach PRISM through your proxy. Point the"
  echo "  proxy at http://<this machine>:${APP_PORT}."
  while true; do
    read -r -p "  Address (https://…): " input
    input="${input%/}"
    if [[ "$input" =~ ^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$ ]]; then
      PUBLIC_URL="$input"
      return
    fi
    warn "That isn't an https:// address (like https://helpdesk.example.com, with no path)."
  done
}

# The test certificate's port and addresses. Sets HTTPS_PORT and TLS_NAMES.
ask_test_https() {
  local guess input name
  command -v openssl &>/dev/null || die "openssl is needed to make the test certificate. Install it and re-run setup.sh."
  choose_port HTTPS_PORT "8443" "Host port for HTTPS"
  guess="$(lan_ip)"
  local host_name
  host_name="$(hostname 2>/dev/null || true)"
  [[ "$host_name" =~ ^[A-Za-z0-9.-]+$ ]] && guess="${guess:+${guess} }${host_name}"
  echo "  Other computers will reach PRISM at which address(es)? Give IPs and/or"
  echo "  names, separated by spaces. The first is the one PRISM uses in links."
  while true; do
    read -r -p "  Addresses [${guess}]: " input
    input="${input:-$guess}"
    TLS_NAMES=""
    for name in $input; do
      if ! [[ "$name" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
        warn "\"${name}\" isn't an IP address or host name."
        TLS_NAMES=""; break
      fi
      TLS_NAMES="${TLS_NAMES:+${TLS_NAMES},}${name}"
    done
    [[ -n "$TLS_NAMES" ]] && break
    [[ -z "$input" ]] && warn "Enter at least one address."
  done
  return 0
}

https_url() { # first name, port
  if [[ "$2" == "443" ]]; then echo "https://$1"; else echo "https://$1:$2"; fi
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
# docker compose finds .env and the compose files in the current folder.
cd "$SCRIPT_DIR"

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

# Which published image build to run. latest tracks released code; set a
# version (e.g. 0.2.0) to pin or roll back, or dev for a test instance.
# See RELEASING.md.
IMAGE_TAG=${IMAGE_TAG:-latest}

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

# ---------------------------------------------------------------------------
# How people reach PRISM: their own HTTPS proxy, a test certificate, or HTTP
# ---------------------------------------------------------------------------
TLS_ON=false
TLS_NAMES=""
HTTPS_PORT=""
CA_STATE=""
ACCESS_MODE=""
PUBLIC_URL=""
if [[ "$(env_get COMPOSE_FILE)" == *docker-compose.tls.yml* ]]; then
  TLS_ON=true
  TLS_NAMES="$(env_get TEST_CERT_NAMES)"
  HTTPS_PORT="$(env_get HTTPS_PORT)"
  HTTPS_PORT="${HTTPS_PORT:-8443}"
  [[ -n "$TLS_NAMES" ]] || die ".env serves HTTPS but has no TEST_CERT_NAMES. Add TEST_CERT_NAMES=<address> to .env, or remove the COMPOSE_FILE line to go back to HTTP."
  command -v openssl &>/dev/null || die "openssl is needed to check the test certificate. Install it and re-run setup.sh."
elif [[ -n "$(env_get PUBLIC_APP_URL)" ]]; then
  # Already set (an earlier run, or by hand): keep it.
  PUBLIC_URL="$(env_get PUBLIC_APP_URL)"
  [[ "$PUBLIC_URL" == https://* ]] && ACCESS_MODE=proxy || ACCESS_MODE=http
else
  ask_access_mode
  case "$ACCESS_MODE" in
    proxy)
      ask_proxy_url
      env_set PUBLIC_APP_URL "$PUBLIC_URL"
      env_set COOKIE_SECURE "true"
      success ".env updated: PRISM is at ${PUBLIC_URL}."
      ;;
    test)
      ask_test_https
      TLS_ON=true
      env_set COMPOSE_FILE "docker-compose.yml:docker-compose.tls.yml"
      env_set HTTPS_PORT "$HTTPS_PORT"
      env_set TEST_CERT_NAMES "$TLS_NAMES"
      env_set COOKIE_SECURE "true"
      env_set PUBLIC_APP_URL "$(https_url "${TLS_NAMES%%,*}" "$HTTPS_PORT")"
      success ".env updated for HTTPS."
      ;;
    http)
      local_ip="$(lan_ip)"
      PUBLIC_URL="http://${local_ip:-localhost}:${APP_PORT}"
      env_set PUBLIC_APP_URL "$PUBLIC_URL"
      env_set COOKIE_SECURE "false"
      warn "Plain HTTP: the PRISM agent won't enrol and sign-in cookies aren't secure. Re-run setup.sh to switch to HTTPS later."
      ;;
  esac
fi

if [[ "$TLS_ON" == true ]]; then
  info "Checking the test certificate..."
  CA_STATE="$(ensure_test_cert "$TLS_NAMES")"
  success "Test certificate ready for: ${TLS_NAMES//,/, } (expires $(openssl x509 -enddate -noout -in "${CERT_DIR}/server.crt" | cut -d= -f2))."
  if [[ "$CA_STATE" == new ]]; then
    warn "This is a NEW test certificate authority: computers that trusted an earlier one must trust ${CERT_DIR}/prism-test-ca.crt again."
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
if [[ "$TLS_ON" == true ]]; then
  # Over HTTPS, trusting only the test authority: this checks the certificate too.
  HEALTH=(curl -sf --cacert "${CERT_DIR}/prism-test-ca.crt" "https://localhost:${HTTPS_PORT}/api/v1/health")
else
  HEALTH=(curl -sf "http://localhost:${APP_PORT}/api/v1/health")
fi
for i in $(seq 1 24); do
  if "${HEALTH[@]}" >/dev/null 2>&1; then
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
  echo -e "  Health endpoint:   ${CYAN}${HEALTH[*]}${RESET}"
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
if [[ "$TLS_ON" == true ]]; then
  echo -e "  ${BOLD}URL:${RESET}       $(https_url "${TLS_NAMES%%,*}" "$HTTPS_PORT")  (http://…:${APP_PORT} redirects here)"
elif [[ "$ACCESS_MODE" == proxy ]]; then
  echo -e "  ${BOLD}URL:${RESET}       ${PUBLIC_URL}  (through your proxy; on this machine: http://localhost:${APP_PORT})"
else
  echo -e "  ${BOLD}URL:${RESET}       ${PUBLIC_URL:-http://localhost:${APP_PORT}}"
fi
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

if [[ "$TLS_ON" == true ]]; then
  echo ""
  echo -e "  ${YELLOW}${BOLD}Test certificate — for testing only.${RESET} Trust it once on each test computer"
  echo -e "  (download it from $(https_url "${TLS_NAMES%%,*}" "$HTTPS_PORT")/prism-test-ca.crt, or copy ${CERT_DIR}/prism-test-ca.crt):"
  echo -e "    Mac:      ${CYAN}sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain prism-test-ca.crt${RESET}"
  echo -e "    Windows:  ${CYAN}certutil -addstore -f Root prism-test-ca.crt${RESET}   (as administrator)"
  echo -e "    Ubuntu:   ${CYAN}sudo cp prism-test-ca.crt /usr/local/share/ca-certificates/ && sudo update-ca-certificates${RESET}"
  echo -e "    Fedora/Arch: ${CYAN}sudo trust anchor --store prism-test-ca.crt${RESET}"
  echo -e "  Keep ${CA_DIR}/ private: it can sign certificates for these addresses."
  echo -e "  Back to plain HTTP: delete the COMPOSE_FILE line in .env, set COOKIE_SECURE=false,"
  echo -e "  remove PUBLIC_APP_URL, then ${CYAN}${COMPOSE} up -d${RESET}"
fi

if [[ "$ACCESS_MODE" == proxy ]]; then
  echo ""
  echo -e "  ${BOLD}Your proxy:${RESET} forward ${PUBLIC_URL} to http://<this machine>:${APP_PORT}, and allow"
  echo -e "  uploads up to 30 MB (nginx: ${CYAN}client_max_body_size 30m;${RESET}; Nginx Proxy Manager: the"
  echo -e "  host's Advanced tab). Agent inventories and ticket attachments need it."
fi

echo ""
echo -e "  Stop PRISM:   ${CYAN}${COMPOSE} down${RESET}"
echo -e "  View logs:    ${CYAN}${COMPOSE} logs -f${RESET}"
echo -e "  Update:       ${CYAN}${COMPOSE} pull && ${COMPOSE} up -d${RESET}"
echo ""
