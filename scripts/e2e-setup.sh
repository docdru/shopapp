#!/usr/bin/env sh
# Starts a throwaway PocketBase with the repo's migrations and the built app,
# and creates two test users in the seeded "Family" household.
# Usage: scripts/e2e-setup.sh <path-to-pocketbase-binary>
set -eu

PB="$1"
DATA="${E2E_DATA:-/tmp/pb_e2e}"
URL="http://127.0.0.1:8090"
ADMIN_EMAIL="admin@example.com"
ADMIN_PASS="admin-password-123"

rm -rf "$DATA"
"$PB" migrate up --dir "$DATA" --migrationsDir pb/pb_migrations >/dev/null
"$PB" superuser upsert "$ADMIN_EMAIL" "$ADMIN_PASS" --dir "$DATA" >/dev/null

"$PB" serve --http 127.0.0.1:8090 --dir "$DATA" --migrationsDir pb/pb_migrations \
  --publicDir web/build --dev=false > /tmp/pb_e2e.log 2>&1 &

for _ in $(seq 1 30); do
  curl -fs "$URL/api/health" >/dev/null && break
  sleep 0.5
done

json() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }

TOKEN=$(curl -fs -X POST "$URL/api/collections/_superusers/auth-with-password" \
  -H 'content-type: application/json' \
  -d "{\"identity\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" | json '["token"]')
# Several test logins from one IP within seconds would hit the auth rate
# limit (enabled in the settings migration), so switch it off for tests.
curl -fs -X PATCH "$URL/api/settings" -H "Authorization: $TOKEN" \
  -H 'content-type: application/json' -d '{"rateLimits":{"enabled":false}}' >/dev/null

HOUSEHOLD=$(curl -fs "$URL/api/collections/households/records" -H "Authorization: $TOKEN" | json '["items"][0]["id"]')

# Carla is only used by the password-change test.
for user in "Anna:anna@example.com:test-password-1" "Ben:ben@example.com:test-password-2" \
            "Carla:carla@example.com:test-password-3"; do
  name=${user%%:*}; rest=${user#*:}; email=${rest%%:*}; pass=${rest#*:}
  curl -fs -X POST "$URL/api/collections/users/records" -H "Authorization: $TOKEN" \
    -H 'content-type: application/json' \
    -d "{\"name\":\"$name\",\"email\":\"$email\",\"password\":\"$pass\",\"passwordConfirm\":\"$pass\",\"household\":\"$HOUSEHOLD\",\"verified\":true}" >/dev/null
done

echo "PocketBase ready on $URL with users anna@, ben@ and carla@example.com"
