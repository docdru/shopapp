# Deployment

The app is one Docker container: PocketBase serving the API, realtime sync and
the built PWA. The existing nginx on the server terminates HTTPS (Let's
Encrypt) and proxies to it. The admin dashboard is never public. You reach it
through an SSH tunnel.

```
Android / browser ──HTTPS 443──▶ nginx ──▶ 127.0.0.1:8090 ──▶ container "shopapp"
                                   │                          └─ PB_DATA_DIR on the gocryptfs drive
                       only the app's API paths; /_/ and all admin APIs → 404
You (admin) ──SSH tunnel──────────────────▶ 127.0.0.1:8090/_/
```

## First setup

1. **DNS:** point a subdomain (e.g. `einkauf.example.com`) at the server.
2. **Certificate:** get one for that subdomain the way you do for your other sites
   (e.g. `sudo certbot certonly --nginx -d einkauf.example.com`).
3. **nginx:** copy `nginx/shopapp.conf.example` to
   `/etc/nginx/sites-available/`, replace every `einkauf.example.com`, link it
   into `sites-enabled`, then run `sudo nginx -t && sudo systemctl reload nginx`.
4. **Data folder** on the encrypted drive: see [Data on the encrypted drive](#data-on-the-encrypted-drive-gocryptfs)
   below, then set `PB_DATA_DIR` (and maybe `PB_UID`/`PB_GID`) in `.env`.
5. **App:** on the server, in e.g. `/opt/shopapp/`, put `compose.yml` and
   `.env.example` from this folder, then:
   ```sh
   cp .env.example .env            # set PB_DATA_DIR (and PB_UID/PB_GID if needed)
   docker login ghcr.io            # only while the image is private (GitHub token with read:packages)
   docker compose pull
   docker compose up -d
   ```
6. **Admin account:** use a long random password from your password manager.
   ```sh
   docker compose exec app /pb/pocketbase superuser upsert you@example.com 'long-random-password' \
     --dir /pb/pb_data --encryptionEnv=PB_ENCRYPTION_KEY
   ```
   The server wants at least 12 characters for an admin password.
7. **Family accounts:** open the admin dashboard (below) → *users* → *New record*,
   one per family member (name, email, password, household "Family", verified).
   Sign-up from the app is disabled on purpose. Passwords need at least 10
   characters. The login page is public, so pick ones nobody could guess
   (a password manager or a few random words), not a name plus a year.
8. On each Android phone, open the site in Chrome and choose **Add to Home screen**
   or **Install app**.
9. Optional: **single sign-on** with two-factor authentication through your
   own identity provider, see [Single sign-on (OIDC)](#single-sign-on-oidc).

## Data on the encrypted drive (gocryptfs)

The database and uploads are bind-mounted from `PB_DATA_DIR`, a folder **inside**
the gocryptfs mount (not the mount point itself), e.g.
`/mnt/secure/shopapp/pb_data`. Two safety properties come from that:

- **Encrypted at rest.** Nothing of the app's data touches the plain disk. (A
  Docker named volume would have lived under `/var/lib/docker`, outside the
  encrypted drive.)
- **No silent plaintext database.** While the drive is locked, the folder doesn't
  exist and the container **refuses to start** (`create_host_path: false`), also
  for `restart: unless-stopped` after a reboot. Without that, Docker would create
  an empty folder on the plain disk and PocketBase would start a fresh, unencrypted
  database there. Tested: missing folder → "bind source path does not exist"; an
  existing container won't start either.

### One-time setup

1. **Allow Docker to see the FUSE mount.** By default a gocryptfs mount is visible
   only to the user who mounted it; even root (the Docker daemon) gets
   "permission denied". In `/etc/fuse.conf`, enable `user_allow_other` and mount
   with `-allow_other`:
   ```sh
   gocryptfs -allow_other /srv/secure.cipher /mnt/secure
   ```
2. **Create the folder and give the container write access.** Which way depends
   on who mounts gocryptfs:
   - **Mounted as root** (e.g. `sudo gocryptfs …`): keep `PB_UID=10001`, `PB_GID=10001`
     and run
     `sudo mkdir -p /mnt/secure/shopapp/pb_data && sudo chown 10001:10001 /mnt/secure/shopapp/pb_data`
   - **Mounted as your own user:** ownership on the mount is always yours, so run
     the container as you: set `PB_UID=$(id -u)` and `PB_GID=$(id -g)` in `.env`, then
     `mkdir -p /mnt/secure/shopapp/pb_data`.
3. Set `PB_DATA_DIR=/mnt/secure/shopapp/pb_data` in `.env`.

Afterwards, check: add an item in the app, run `docker compose restart`, and
make sure it's still there. Also run `ls /mnt/secure/shopapp/pb_data` and
confirm you see `data.db`.

### After a reboot

- **Unlocked by hand** (password prompt): the container fails to start at boot.
  That's intended. Unlock, then start it:
  ```sh
  gocryptfs -allow_other /srv/secure.cipher /mnt/secure
  cd /opt/shopapp && docker compose up -d
  ```
- **Unlocked automatically** (key file, systemd unit or similar): make the
  container wait for it. Docker's restart policy doesn't retry a failed start.
  The simplest approach: set `restart: "no"` in `compose.yml`, and add
  `docker compose -f /opt/shopapp/compose.yml up -d` as the last step of
  whatever unlocks the drive (e.g. `ExecStartPost=` in its systemd unit).

### What `PB_ENCRYPTION_KEY` adds

Not much, while everything sits on the encrypted drive. It encrypts only
PocketBase's settings record (SMTP password, S3 backup keys), not the data. It
matters once backups leave the drive: then the S3 keys inside a backup stay
encrypted. Leave it empty until you configure SMTP or S3 backups.

## Admin dashboard (SSH tunnel)

nginx lets through only the API paths the app itself uses: its own
collections, product photos, realtime sync and the health check. Everything
else under `/api/` and the dashboard at `/_/` answer `404`: the superuser
login, settings, backups, logs. Nobody on the internet can even try the admin
login. (The template lists what is allowed, not what is blocked, because
PocketBase also answers to a collection's id and to any letter case of its
name, so a block by name can be walked around.) To administer, tunnel to the
container from your computer:

```sh
ssh -L 8090:127.0.0.1:8090 you@your-server
# then open http://localhost:8090/_/ in your browser
```

This works from anywhere you can SSH from, including your laptop on mobile
data. It doesn't depend on your home IP.

Recommended once SMTP is configured (Settings → Mail settings): enable **MFA**
for superusers (*superusers* collection → Options → Multi-factor
authentication). PocketBase's second factor is a one-time code sent by email.
It doesn't support authenticator apps.

## Single sign-on (OIDC)

Instead of (or next to) email + password, the family can sign in through an
OpenID Connect provider you run or trust: Authelia, Keycloak, Authentik,
Pocket ID, Google, … Two-factor authentication is then the provider's job:
ShopApp trusts a completed sign-in and asks for nothing more. The examples
below use Authelia.

Everything is set in `.env` and applied at every start, no dashboard needed:

| Variable | Meaning |
| --- | --- |
| `OIDC_ISSUER` | The provider's issuer URL, e.g. `https://auth.example.com`. The endpoints are read from `<issuer>/.well-known/openid-configuration` at start. |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | The client you register at the provider (below). |
| `OIDC_NAME` | Button label: "Sign in with *Authelia*". Default "SSO". |
| `OIDC_AUTH_URL`, `OIDC_TOKEN_URL`, `OIDC_USERINFO_URL` | Only if discovery doesn't work: explicit endpoints, each overrides the discovered one. |
| `PASSWORD_LOGIN` | `on` (default) or `off`. |

Three modes: nothing set = password only (as before); provider set = both;
provider set and `PASSWORD_LOGIN=off` = single sign-on only. With it off, the
server refuses password sign-in for family accounts (not just the page), and
the account sheet hides "Change password". **Lock-out guard:**
`PASSWORD_LOGIN=off` only takes effect while the provider is fully configured
(client ID, secret and all three endpoints). Otherwise password sign-in stays
on and the log says why. The admin (superuser) is not affected by any of this:
still password only, still only through the SSH tunnel.

What happens at the first single sign-on: ShopApp **doesn't create
accounts**. It links the provider account to the existing family account
with the same email address, and from then on uses that link (even if the
email changes at the provider). Without a matching account, the login page
says so and nothing is created. Only an email the provider marks as verified
(`email_verified`) is used for this. **You must trust the provider's email
addresses:** whoever controls an account there with a family member's email
signs in as that family member. With your own Authelia and its user list
that's you.

### 1. Register ShopApp at the provider (Authelia)

Generate a client secret and its digest (Authelia stores only the digest):

```sh
docker run --rm authelia/authelia:latest authelia crypto hash generate pbkdf2 \
  --variant sha512 --random --random.length 72 --random.charset rfc3986
```

It prints a *Random Password* (goes into ShopApp's `.env` as
`OIDC_CLIENT_SECRET`) and a *Digest* (goes into Authelia's config). Add the
client to Authelia's `configuration.yml` (Authelia 4.38 or later; merge it
into your existing `identity_providers.oidc` section) and restart Authelia:

```yaml
identity_providers:
  oidc:
    clients:
      - client_id: 'shopapp'
        client_name: 'ShopApp'
        client_secret: '$pbkdf2-sha512$310000$...'   # the Digest
        public: false
        authorization_policy: 'two_factor'
        require_pkce: true
        pkce_challenge_method: 'S256'
        redirect_uris:
          - 'https://einkauf.example.com/login/callback'
        scopes: ['openid', 'email', 'profile']
        response_types: ['code']
        grant_types: ['authorization_code']
        token_endpoint_auth_method: 'client_secret_basic'
        # Ask for consent once, then remember it for a year:
        consent_mode: 'pre-configured'
        pre_configured_consent_duration: '1y'
```

Every family member needs an Authelia user whose `email` is the same as the
email of their ShopApp account. Other providers: create a "confidential" web
client with the authorization code flow and PKCE (S256), the redirect URI
`https://<your app>/login/callback` and the scopes `openid email profile`.

### 2. Configure ShopApp

In `/opt/shopapp/.env`:

```sh
OIDC_ISSUER=https://auth.example.com
OIDC_CLIENT_ID=shopapp
OIDC_CLIENT_SECRET=<the Random Password>
OIDC_NAME=Authelia
PASSWORD_LOGIN=on
```

Then `docker compose up -d` and check the log:

```sh
docker compose logs app | grep sign-in
# [sign-in] password sign-in on, single sign-on "Authelia" (https://auth.example.com/api/oidc/authorization)
```

A `[sign-in] WARNING` line says what's missing or unreachable. The nginx site
needs no change: the login uses only paths that are already allowed.

**Can the container reach the provider?** ShopApp's server talks to the
provider directly (discovery at start, and the code exchange at every
sign-in), under the provider's public name. With Authelia on the same host
that normally works through your nginx. To check:

```sh
docker compose exec app wget -qO- https://auth.example.com/.well-known/openid-configuration | head -c 200
```

If that fails (DNS points somewhere the container can't reach, or a firewall
blocks traffic from Docker to the host), map the name to the host in
`compose.yml` (the commented `extra_hosts` block):
`"auth.example.com:host-gateway"`. That works if nginx listens on all
addresses; otherwise use the server's public IP instead of `host-gateway`.
If the provider is down while ShopApp starts, ShopApp keeps the endpoints from
its last successful start and logs a warning.

### 3. Moving the family over

1. Start with both on (`PASSWORD_LOGIN=on`, as above).
2. Everyone signs in once with the button. That links their account. Passwords
   keep working meanwhile. (If an account wasn't marked *verified*, the first
   single sign-on marks it verified and leaves the password as it is.)
3. Check that everyone is linked (next section).
4. Set `PASSWORD_LOGIN=off`, `docker compose up -d`. The login page now shows
   only the button, and the server refuses password sign-in.
5. Optional: devices that are already signed in stay signed in (sessions work
   as before), so they won't see the second factor until they sign in again.
   To make every device sign in again now: dashboard → *users* → ⚙ (collection
   settings) → *Options* → *Token options (invalidate, duration)* → *Auth* →
   **Invalidate all previously issued tokens**, then save.

Passwords aren't deleted when password sign-in is off. Switching it back on is
the same change the other way round.

### Who is linked?

Dashboard (SSH tunnel) → *users* → open a person → tab **Auth providers**:
it lists the linked provider account (with its ID at the provider), or "No
external auth providers found." Unlink there if the wrong account got linked
or the person has a new one at the provider; their next single sign-on links
again by email. For everyone at once: show the system collections in the
sidebar → **`_externalAuths`**, one row per link (`recordRef` = the user's id).

### Recovery

- **Provider down, broken or gone:** set `PASSWORD_LOGIN=on` (or remove the
  `OIDC_*` lines) and `docker compose up -d`. Passwords work again right away.
- **Someone forgot their password** (likely after months of single sign-on
  only): set a new one for them in the dashboard → *users*.
- **Locked out of the dashboard:** unaffected by single sign-on; reset the
  admin with `superuser upsert` (First setup, step 6).

## Updates

Every merge to `main` publishes `ghcr.io/docdru/shopapp:latest`; tags
`vX.Y.Z` publish matching versions.

```sh
docker compose pull && docker compose up -d
```

Pending schema migrations run automatically when the container starts. To pin
a version, set `APP_TAG=v0.1.0` in `.env`.

**The nginx site is not part of the image.** When `nginx/shopapp.conf.example`
changes in the repository (the release notes or the PR say so), copy the
changed parts into `/etc/nginx/sites-available/shopapp.conf` and reload nginx:
`sudo nginx -t && sudo systemctl reload nginx`. A quick check from any computer
that the admin login is closed (all three must print `404`):

```sh
for c in _superusers _SUPERUSERS pbc_3142635823; do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://einkauf.example.com/api/collections/$c/auth-with-password"
done
```

## Backups

Everything lives in `PB_DATA_DIR`. A backup that leaves the encrypted drive
leaves its protection behind, so encrypt it on the way out. Either:

- enable scheduled backups in the dashboard (Settings → Backups) to an
  S3-compatible bucket off the server, with server-side encryption on the bucket.
  Set `PB_ENCRYPTION_KEY` first, so the S3 keys stored in PocketBase (and inside
  each backup) are encrypted. Or:
- archive the folder nightly, encrypted, e.g. with [age](https://age-encryption.org):
  `tar czf - -C "$PB_DATA_DIR" . | age -r <your-age-public-key> > /backup/pb_data-$(date +%F).tgz.age`
  (For a consistent copy, stop the container briefly or use PocketBase's own backups.)

Backups contain the full event log, so store them as privately as the server
itself.

**If you set `PB_ENCRYPTION_KEY`:** keep a copy with your backups (e.g. in the
password manager). Without it, a restored database won't start. Any `pocketbase`
CLI command you run inside the container (e.g. `superuser upsert`) then needs
`--encryptionEnv=PB_ENCRYPTION_KEY` too.

## Security model

| Layer | What protects it |
| --- | --- |
| Network | Container publishes only on `127.0.0.1:8090`; nginx is the single way in, over HTTPS (HSTS). |
| Admin | nginx passes only the API paths the app uses (allow-list), so the dashboard, the superuser login and the settings, backups and logs APIs aren't reachable from outside under any spelling; admin only via SSH tunnel. Long random superuser password (at least 12 characters); email MFA recommended. |
| Accounts | No public sign-up, also not through single sign-on (`users.createRule` stays null). One login per family member. Passwords need at least 10 characters (checked by the server). Login is rate-limited per client IP; there is no lock-out after failed attempts, so the passwords themselves have to be hard to guess, or password sign-in switched off once everyone uses single sign-on (`PASSWORD_LOGIN=off`, refused by the server, not just hidden). |
| Single sign-on | Optional OIDC provider (e.g. Authelia, which enforces 2FA), authorization code flow with PKCE (S256), code exchanged by the server with the client secret; the app checks the `state` it stored before leaving. Links only to an existing account, by an email the provider marks verified, so the provider's email addresses must be trustworthy. Lock-out guard keeps password sign-in on unless the provider is fully configured. Logging out of ShopApp doesn't log out of the provider. |
| Data | Every collection is limited to signed-in users of the same household (checked server-side). The event log is append-only. |
| Browser | Session token in localStorage, sent as an `Authorization` header. No cookies, so CSRF doesn't apply. XSS is limited by a strict Content-Security-Policy (no foreign scripts, connections only to our origin), plus `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy` and `Permissions-Policy` headers. |
| Container | Runs as non-root (uid 10001), `no-new-privileges`, all capabilities dropped, memory and PID limits. PocketBase download verified by SHA-256. |
| Data at rest | Database and uploads on the gocryptfs drive; container won't start while it's locked. Optional `PB_ENCRYPTION_KEY` for settings secrets (SMTP, S3) in backups. |
| Photos | Product photos are protected files: served only with a short-lived file token of a signed-in household member, so a leaked link shows nothing. JPEG / PNG / WebP only (no SVG, which can carry scripts), max 3 MB; the app shrinks them to 1024 px first, which also drops the camera's location metadata. |
| Supply chain | Dependabot weekly updates; gitleaks secret scan on every PR. |

**Trusted proxy, read before changing the setup:** PocketBase is configured
(in a migration) to take the client IP from the `X-Real-IP` header, for rate
limiting and logs. That's only safe because nginx always overwrites that header
and the container is reachable only on `127.0.0.1`. If you ever publish the
port elsewhere or put another proxy in front, a client could fake its IP and
dodge the rate limit. Revisit the setting (dashboard → Settings → Application
→ trusted proxy) first. To check the port on the server: `ss -ltn | grep 8090`
must show `127.0.0.1:8090` only, never `0.0.0.0:8090` or `[::]:8090`.

**What the app doesn't limit:** the event log only grows (nobody can delete
from it, on purpose), and there is no storage quota per person. Anyone with a
login could fill the drive, so keep an eye on its free space.

**Changing passwords:** each family member can change their own password in the
app: tap your name at the top → *Account* (hidden while password sign-in is
off; with single sign-on, the password and second factor are changed at the
provider). **Lost phone or departing user:**
change that user's password in the dashboard, or have them change it from
another device. Either way, all their other sessions end: a signed-out phone
shows the login page the next time it's opened or used. With single sign-on
only, also disable or reset the person at the provider, so the lost phone
can't sign in again.
