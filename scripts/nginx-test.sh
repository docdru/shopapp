#!/usr/bin/env bash
# CI check of deploy/nginx/shopapp.conf.example: runs the real template
# in an nginx container (self-signed cert) in front of the e2e PocketBase on
# 127.0.0.1:8090, then checks that the admin surface is blocked, that every
# collection of the app is on the API allow-list, and that the security
# headers are present. Needs Docker and sudo (for /etc/hosts).
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
  got=$(curl -ks --path-as-is -o /dev/null -w '%{http_code}' -X "$2" "$URL$1")
  if [ "$got" = "$3" ]; then echo "ok   $2 $1 -> $got"; else echo "FAIL $2 $1 -> $got (want $3)"; fail=1; fi
}
expect_status /api/health GET 200
expect_status /login GET 200
# Single sign-on return address (a client-side route of the app).
expect_status /login/callback GET 200

# Admin surface: dashboard and every superuser / settings API.
expect_status /_ GET 404
expect_status /_/ GET 404
expect_status /api/collections/_superusers/auth-with-password POST 404
expect_status /api/collections/_superusers/records GET 404
# PocketBase also accepts the collection id and any letter case.
expect_status /api/collections/pbc_3142635823/auth-with-password POST 404
expect_status /api/collections/pbc_3142635823/records GET 404
expect_status /api/collections/_SUPERUSERS/auth-with-password POST 404
expect_status /api/collections/_Superusers/request-password-reset POST 404
# Path tricks must not turn an allowed prefix into the superuser collection.
expect_status /api/collections/users/../_superusers/auth-with-password POST 404
expect_status /api/collections/users/%2e%2e/_superusers/auth-with-password POST 404
expect_status /api/collections/users/..%2f_superusers/auth-with-password POST 404
expect_status /api/collections//_superusers/auth-with-password POST 404
expect_status /api/collections GET 404
expect_status /api/collections/users GET 404
expect_status /api/collections/import PUT 404
expect_status /api/settings GET 404
expect_status /api/backups GET 404
expect_status /api/logs GET 404
expect_status /api/crons GET 404
expect_status /api/batch POST 404
expect_status /api/ GET 404
expect_status /api/not-a-real-endpoint GET 404
# PocketBase's popup/realtime OAuth2 flow; the app uses the redirect flow, so it stays closed.
expect_status /api/oauth2-redirect GET 404
expect_status /api/oauth2-redirect POST 404

# Every collection the app uses must be on the template's allow-list: ask
# PocketBase (directly, as the e2e admin) for its collections and check that
# each one answers through nginx. A guest gets 200 with an empty list.
token=$(curl -fs -X POST http://127.0.0.1:8090/api/collections/_superusers/auth-with-password \
  -H 'content-type: application/json' \
  -d '{"identity":"admin@example.com","password":"admin-password-123"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')
collections=$(curl -fs "http://127.0.0.1:8090/api/collections?perPage=200&fields=name,system" -H "Authorization: $token" \
  | python3 -c 'import sys,json; print(" ".join(c["name"] for c in json.load(sys.stdin)["items"] if not c["system"]))')
[ -n "$collections" ] || { echo "FAIL no collections found"; fail=1; }
for c in $collections; do expect_status "/api/collections/$c/records" GET 200; done
# Login endpoints and file tokens (401 = reached PocketBase, which wants a login).
expect_status /api/collections/users/auth-methods GET 200
# Single sign-on code exchange: 403 = reached PocketBase, which has no provider in this test.
expect_status /api/collections/users/auth-with-oauth2 POST 403
expect_status /api/files/token POST 401

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
