#!/bin/sh
# Checks the frontend's nginx config in the image the frontend ships in
# (nginx:1.27-alpine), laid out as frontend/Dockerfile lays it out.
#   Plain HTTP (the default): client-side routes load the app on a hard
#   refresh (including /assets, which shares its name with the build's assets/
#   folder), hashed files are served with caching, the hardening headers are on
#   every response, and there's no test certificate to download.
#   HTTPS (a certificate in /etc/nginx/certs, made by setup.sh's own code):
#   the same site over TLS, plain HTTP redirects to it, and the test
#   certificate authority can be downloaded.
# Usage: sh frontend/scripts/check-nginx.sh   (needs docker, bash and openssl)
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
root=$(cd "$here/.." && pwd)
work=$(mktemp -d)
trap 'docker rm -f prism-nginx-check prism-nginx-check-tls >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
site="$work/site"
mkdir -p "$site/assets"
echo '<!doctype html><title>app</title>' > "$site/index.html"
echo 'console.log(1)' > "$site/assets/index-abc123.js"
echo 'font' > "$site/assets/inter-abc123.woff2"
chmod -R a+rX "$site"

# The test certificate, made by setup.sh's functions (everything above its banner).
sed -n '1,/^# Banner/p' "$root/setup.sh" | sed '$d' > "$work/setup-fns.sh"
(cd "$work" && ENV_FILE="$work/.env" bash -c '. ./setup-fns.sh && ensure_test_cert 127.0.0.1,prism.test >/dev/null')
chmod -R a+rX "$work/certs"

start() { # name, extra docker args...
  name=$1; shift
  mkdir -p "$work/$name" && cp "$here/nginx.conf" "$work/$name/default.conf" && chmod -R a+rwX "$work/$name"
  docker run -d --rm --name "$name" --add-host backend:127.0.0.1 \
    -v "$work/$name:/etc/nginx/conf.d" \
    -v "$here/nginx.conf:/etc/nginx/prism/plain.conf:ro" \
    -v "$here/nginx/site.conf:/etc/nginx/prism/site.conf:ro" \
    -v "$here/nginx/tls.conf:/etc/nginx/prism/tls.conf:ro" \
    -v "$here/nginx/test-ca.conf:/etc/nginx/prism/test-ca.conf:ro" \
    -v "$here/nginx/tls-on.sh:/docker-entrypoint.d/40-prism-tls-on.sh:ro" \
    -v "$site:/usr/share/nginx/html:ro" "$@" nginx:1.27-alpine >/dev/null
}
start prism-nginx-check -p 127.0.0.1:18089:80
start prism-nginx-check-tls -p 127.0.0.1:18090:80 -p 127.0.0.1:18443:443 \
  -e PRISM_HTTPS_PORT=18443 -v "$work/certs:/etc/nginx/certs:ro"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -s -o /dev/null http://127.0.0.1:18089/ && curl -s -o /dev/null --cacert "$work/certs/prism-test-ca.crt" https://localhost:18443/ && break
  sleep 0.5
done

fail=0
check() { # name, url, expected status, [header that must be present]
  out=$(curl -s -o /dev/null -D - --cacert "$work/certs/prism-test-ca.crt" "$2")
  code=$(printf '%s' "$out" | head -1 | awk '{print $2}')
  if [ "$code" != "$3" ]; then echo "FAIL $1: $2 gave $code, want $3"; fail=1; return; fi
  if [ -n "${4:-}" ] && ! printf '%s' "$out" | grep -qi "^$4"; then echo "FAIL $1: $2 lacks $4"; fail=1; return; fi
  echo "ok   $1"
}
for base in http://127.0.0.1:18089 https://localhost:18443; do
  echo "-- $base"
  check "app root" $base/ 200 "X-Content-Type-Options: nosniff"
  check "client route" $base/tickets/12 200 "X-Frame-Options: DENY"
  check "/assets refresh loads the app" $base/assets 200 "X-Frame-Options: DENY"
  check "/assets/ refresh loads the app" $base/assets/ 200
  check "an asset's page loads the app" $base/assets/12 200 "X-Frame-Options: DENY"
  check "a Licenses page loads the app" $base/assets/licenses/3 200
  check "the Contracts page loads the app" $base/assets/contracts 200
  check "an asset's page isn't cached as a file" $base/assets/12 200 "Content-Type: text/html"
  check "hashed file" $base/assets/index-abc123.js 200 "Cache-Control: public, immutable"
  check "a font" $base/assets/inter-abc123.woff2 200 "Cache-Control: public, immutable"
  check "hashed file keeps nosniff" $base/assets/index-abc123.js 200 "X-Content-Type-Options: nosniff"
  check "missing hashed file is a 404" $base/assets/index-missing.js 404
done
echo "-- plain HTTP"
check "no test certificate to download" http://127.0.0.1:18089/prism-test-ca.crt 404
echo "-- HTTPS"
check "HTTP redirects to HTTPS" http://127.0.0.1:18090/tickets/12 301 "Location: https://127.0.0.1:18443/tickets/12"
check "test authority over HTTPS" https://localhost:18443/prism-test-ca.crt 200 "Content-Type: application/x-x509-ca-cert"
check "test authority over plain HTTP" http://127.0.0.1:18090/prism-test-ca.crt 200 "Content-Disposition: attachment"
check "test authority is a download, nosniff" https://localhost:18443/prism-test-ca.crt 200 "X-Content-Type-Options: nosniff"
check "the IP address is in the certificate" https://127.0.0.1:18443/ 200
if curl -s -o "$work/got.crt" --cacert "$work/certs/prism-test-ca.crt" https://localhost:18443/prism-test-ca.crt \
  && cmp -s "$work/got.crt" "$work/certs/prism-test-ca.crt"; then echo "ok   it serves the authority's certificate"
else echo "FAIL the download isn't certs/prism-test-ca.crt"; fail=1; fi
if curl -s -o /dev/null https://localhost:18443/; then echo "FAIL a client that doesn't trust the test authority got in"; fail=1
else echo "ok   untrusted without the test authority"; fi
if docker exec prism-nginx-check-tls test -e /etc/nginx/certs/ca.key; then echo "FAIL the authority's key is in the container"; fail=1
else echo "ok   no authority key in the container"; fi
exit $fail
