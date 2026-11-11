#!/usr/bin/env bash
# CI check of deploy/nginx/shopapp.conf.example: runs the real template
# in an nginx container (self-signed cert) in front of the e2e PocketBase on
# 127.0.0.1:8090, then checks that the admin surface is blocked and the
# security headers are present. Needs Docker and sudo (for /etc/hosts).
set -euo pipefail

DOMAIN=einkauf.example.com
WORK=$(mktemp -d)
LE="$WORK/letsencrypt"
mkdir -p "$LE/live/$DOMAIN" "$WORK/conf.d"

openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$DOMAIN" \
  -keyout "$LE/live/$DOMAIN/privkey.pem" -out "$LE/live/$DOMAIN/fullchain.pem" 2>/dev/null
openssl dhparam -dsaparam -out "$LE/ssl-dhparams.pem" 2048 2>/dev/null
echo "ssl_protocols TLSv1.2 TLSv1.3;" > "$LE/options-ssl-nginx.conf"
cp deploy/nginx/shopapp.conf.example "$WORK/conf.d/shopapp.conf"

docker run -d --name nginx-test --network host \
  -v "$LE:/etc/letsencrypt:ro" -v "$WORK/conf.d:/etc/nginx/conf.d:ro" nginx:stable >/dev/null
grep -q "$DOMAIN" /etc/hosts || echo "127.0.0.1 $DOMAIN" | sudo tee -a /etc/hosts >/dev/null

URL="https://$DOMAIN"
for _ in $(seq 1 20); do curl -ks -o /dev/null "$URL/api/health" && break; sleep 0.5; done

fail=0
expect_status() { # path method expected
  local got
  got=$(curl -ks -o /dev/null -w '%{http_code}' -X "$2" "$URL$1")
  if [ "$got" = "$3" ]; then echo "ok   $2 $1 -> $got"; else echo "FAIL $2 $1 -> $got (want $3)"; fail=1; fi
}
expect_status /api/health GET 200
expect_status /login GET 200
expect_status /_/ GET 404
expect_status /api/collections/_superusers/auth-with-password POST 404
expect_status /api/collections/_superusers/records GET 404
expect_status /api/settings GET 404
expect_status /api/backups GET 404
expect_status /api/logs GET 404

headers=$(curl -ks -D - -o /dev/null "$URL/login" | tr -d '\r')
for h in "strict-transport-security: max-age=31536000" \
         "content-security-policy: frame-ancestors 'none'" \
         "x-frame-options: DENY" \
         "x-content-type-options: nosniff" \
         "referrer-policy: same-origin" \
         "permissions-policy: camera=(self)"; do
  if grep -qi "^$h" <<<"$headers"; then echo "ok   header $h"; else echo "FAIL header $h"; fail=1; fi
done

if [ "$fail" != 0 ]; then
  docker logs nginx-test 2>&1 | tail -20
  exit 1
fi
echo "nginx template OK"
