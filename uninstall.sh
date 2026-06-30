#!/usr/bin/env bash
# PRISM uninstaller — stops all containers, removes Docker volumes and images,
# and deletes the .env file. The repo directory itself is left for you to remove.

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Warning
# ---------------------------------------------------------------------------
echo ""
echo -e "${RED}${BOLD}╔══════════════════════════════════════════════════════╗${RESET}"
echo -e "${RED}${BOLD}║              PRISM  UNINSTALLER                      ║${RESET}"
echo -e "${RED}${BOLD}╚══════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "${BOLD}This will permanently delete:${RESET}"
echo "  • All running PRISM containers"
echo "  • The MariaDB database volume  (mariadb_data)  — all ticket and user data"
echo "  • The uploads volume           (uploads_data)  — all file attachments"
echo "  • The pulled Docker images     (frontend + backend)"
echo "  • The .env file"
echo ""
echo -e "${YELLOW}${BOLD}This action cannot be undone. Back up your data first if you need it.${RESET}"
echo ""

# ---------------------------------------------------------------------------
# Confirmation
# ---------------------------------------------------------------------------
read -r -p "Type \"yes\" to confirm and continue, or anything else to cancel: " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
  echo ""
  echo "Cancelled. Nothing was changed."
  exit 0
fi

echo ""

# ---------------------------------------------------------------------------
# Detect docker compose command
# ---------------------------------------------------------------------------
if docker compose version &>/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE="docker-compose"
else
  echo -e "${YELLOW}Docker Compose not found — skipping container/volume teardown.${RESET}"
  COMPOSE=""
fi

# ---------------------------------------------------------------------------
# Stop containers and remove named volumes
# ---------------------------------------------------------------------------
if [[ -n "$COMPOSE" ]]; then
  echo -e "${CYAN}${BOLD}==>${RESET} Stopping containers and removing volumes..."
  cd "$SCRIPT_DIR"
  $COMPOSE down --volumes --remove-orphans 2>&1 || true
  echo -e "${GREEN}${BOLD}  ✓${RESET} Containers and volumes removed."
  echo ""
fi

# ---------------------------------------------------------------------------
# Remove Docker images
# ---------------------------------------------------------------------------
echo -e "${CYAN}${BOLD}==>${RESET} Removing Docker images..."

IMAGES=(
  "ghcr.io/stevy2191/prism-frontend:latest"
  "ghcr.io/stevy2191/prism-backend:latest"
)

for img in "${IMAGES[@]}"; do
  if docker image inspect "$img" &>/dev/null 2>&1; then
    docker rmi "$img" && echo -e "${GREEN}${BOLD}  ✓${RESET} Removed $img"
  else
    echo -e "    Skipped $img (not present)"
  fi
done

# Also remove any SHA-tagged variants that were pulled alongside latest
SHA_IMAGES=$(docker images --format "{{.Repository}}:{{.Tag}}" \
  | grep -E "^ghcr\.io/stevy2191/prism-(frontend|backend):" 2>/dev/null || true)
if [[ -n "$SHA_IMAGES" ]]; then
  while IFS= read -r img; do
    docker rmi "$img" 2>/dev/null && echo -e "${GREEN}${BOLD}  ✓${RESET} Removed $img" || true
  done <<< "$SHA_IMAGES"
fi

echo ""

# ---------------------------------------------------------------------------
# Remove .env
# ---------------------------------------------------------------------------
echo -e "${CYAN}${BOLD}==>${RESET} Removing .env..."
ENV_FILE="${SCRIPT_DIR}/.env"
if [[ -f "$ENV_FILE" ]]; then
  rm -f "$ENV_FILE"
  echo -e "${GREEN}${BOLD}  ✓${RESET} .env deleted."
else
  echo "    .env not found — skipping."
fi

echo ""

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║              PRISM uninstalled                       ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════╝${RESET}"
echo ""
echo "All PRISM containers, volumes, images, and configuration have been removed."
echo ""
echo "You can now safely delete the PRISM directory:"
echo -e "  ${CYAN}rm -rf ${SCRIPT_DIR}${RESET}"
echo ""
