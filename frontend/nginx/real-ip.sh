#!/bin/sh
# Runs before nginx starts (the image runs /docker-entrypoint.d/*.sh).
# Behind a Cloudflare Tunnel (or another proxy that connects to this nginx),
# every request comes from the proxy's own address, so the backend's per-IP
# limits (10 sign-in attempts per 15 minutes) would count every visitor as one.
# PRISM_TRUSTED_PROXIES lists the addresses that proxy connects from
# (addresses or CIDR ranges, separated by commas or spaces); only for requests
# from those does nginx take the visitor's address from PRISM_REAL_IP_HEADER
# (default CF-Connecting-IP, which Cloudflare sets and a visitor can't). Any
# other client's copy of the header is ignored. Unset: nothing changes.
# Written every start, so a restart follows a changed setting.
set -eu
conf=/etc/nginx/conf.d/00-prism-real-ip.conf
proxies=$(printf '%s' "${PRISM_TRUSTED_PROXIES:-}" | tr ',' ' ')
header="${PRISM_REAL_IP_HEADER:-CF-Connecting-IP}"
if [ -z "$(printf '%s' "$proxies" | tr -d ' ')" ]; then
  rm -f "$conf"
  exit 0
fi
case "$header" in
  ''|*[!A-Za-z0-9-]*) echo "real-ip.sh: PRISM_REAL_IP_HEADER=\"$header\" is not a header name" >&2; exit 1 ;;
esac
{
  echo "# Written by real-ip.sh from PRISM_TRUSTED_PROXIES."
  for p in $proxies; do
    case "$p" in
      *[!0-9A-Fa-f:./]*|*/*/*) echo "real-ip.sh: \"$p\" in PRISM_TRUSTED_PROXIES is not an address or CIDR range" >&2; exit 1 ;;
    esac
    echo "set_real_ip_from $p;"
  done
  echo "real_ip_header $header;"
  echo "real_ip_recursive on;"
} > "$conf.tmp"
mv "$conf.tmp" "$conf"
echo "real-ip.sh: visitor addresses from $header, trusted from: $proxies"
