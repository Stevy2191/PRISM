#!/bin/sh
# Runs before nginx starts (the image runs /docker-entrypoint.d/*.sh). If a
# certificate is mounted at /etc/nginx/certs, serve HTTPS (nginx/tls.conf);
# otherwise plain HTTP (nginx.conf), as before. Written every start, so a
# restarted container follows the certificate being added or taken away.
set -eu
crt=/etc/nginx/certs/server.crt
key=/etc/nginx/certs/server.key
site=/etc/nginx/conf.d/default.conf
if [ ! -f "$crt" ] || [ ! -f "$key" ]; then
  cp /etc/nginx/prism/plain.conf "$site"
  exit 0
fi
port="${PRISM_HTTPS_PORT:-443}"
case "$port" in
  ''|*[!0-9]*) echo "tls-on.sh: PRISM_HTTPS_PORT=\"$port\" is not a port number" >&2; exit 1 ;;
esac
sed "s/PRISM_HTTPS_PORT/$port/g" /etc/nginx/prism/tls.conf > "$site"
echo "tls-on.sh: serving HTTPS with $crt (outside port $port)"
