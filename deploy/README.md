# Deployment

The app is one Docker container: PocketBase serving the API, realtime sync and
the built PWA. The existing nginx on the server terminates HTTPS (Let's
Encrypt) and proxies to it. The admin dashboard is never public. You reach it
through an SSH tunnel.

```
Android / browser ──HTTPS 443──▶ nginx ──▶ 127.0.0.1:8090 ──▶ container "shopapp"
                                   │                          └─ PB_DATA_DIR on the gocryptfs drive
                       /_/ and superuser API → 404
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
7. **Family accounts:** open the admin dashboard (below) → *users* → *New record*,
   one per family member (name, email, password, household "Family", verified).
   Sign-up from the app is disabled on purpose.
8. On each Android phone, open the site in Chrome and choose **Add to Home screen**
   or **Install app**.

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

nginx answers `404` for `/_/`, `/api/collections/_superusers/…` and the
settings, backups and logs APIs. Nobody on the internet can even try the admin
login. To administer, tunnel to the container from your computer:

```sh
ssh -L 8090:127.0.0.1:8090 you@your-server
# then open http://localhost:8090/_/ in your browser
```

This works from anywhere you can SSH from, including your laptop on mobile
data. It doesn't depend on your home IP.

Optional extra: with SMTP configured (Settings → Mail settings), enable **MFA**
for superusers (*superusers* collection → Options → Multi-factor
authentication). PocketBase's second factor is a one-time code sent by email.
It doesn't support authenticator apps.

## Updates

Every merge to `main` publishes `ghcr.io/docdru/shopapp:latest`; tags
`vX.Y.Z` publish matching versions.

```sh
docker compose pull && docker compose up -d
```

Pending schema migrations run automatically when the container starts. To pin
a version, set `APP_TAG=v0.1.0` in `.env`.

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
| Admin | Dashboard and superuser API blocked in nginx; admin only via SSH tunnel. Long random superuser password; optional email MFA. |
| Accounts | No public sign-up. One login per family member. Login is rate-limited per client IP. |
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
→ trusted proxy) first.

**Changing passwords:** each family member can change their own password in the
app: tap your name at the top → *Account*. **Lost phone or departing user:**
change that user's password in the dashboard, or have them change it from
another device. Either way, all their other sessions end: a signed-out phone
shows the login page the next time it's opened or used.
