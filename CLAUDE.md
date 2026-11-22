# CLAUDE.md

ShopApp: family shopping list + household inventory PWA, self-hosted. Read README.md for
setup. The product spec is the source of truth for behaviour. Read
**`docs/spec.md`** before feature work; `docs/prototype/index.html` shows the
intended UI and flows. Both are snapshots of the living
[spec](https://claude.ai/artifact/DPjmRyRE4V32geGviEx4hQ) and
[prototype](https://claude.ai/artifact/9QkWqMkrRvH2H3bqnyfAUK); see `docs/README.md`.

## Stack

- **Backend:** PocketBase 0.40.x (version pinned in `Dockerfile` and `.github/workflows/ci.yml`; bump both together).
- **Frontend:** SvelteKit 3, Svelte 5 runes, TypeScript 6, `adapter-static` SPA (`ssr = false`), served by PocketBase from `pb_public`. Kit config lives in `web/vite.config.ts` (`sveltekit({...})`; there is no `svelte.config.js`). Import from `src/lib` as `#lib/...` with the file extension (`#lib/data.svelte.js`, `#lib/types.js`, `#lib/components/Sheet.svelte`).
- **Realtime:** PocketBase subscriptions (SSE). The service worker (`web/src/service-worker/`, its own tsconfig) caches only the app shell, never `/api`.
- **Deploy:** one Docker image (`Dockerfile`, target `app`) behind the host's nginx. CI publishes to `ghcr.io/docdru/shopapp`.

## Commands

```sh
docker compose -f compose.dev.yml up -d   # PocketBase on :8090 (dashboard /_/)
cd web && pnpm install && pnpm dev        # app on :5173, proxies /api and /_ to :8090
cd web && pnpm check && pnpm build        # must pass before a PR
./pocketbase migrate up --dir /tmp/pb --migrationsDir pb/pb_migrations   # quick migration test
```

## Data model (pb/pb_migrations)

All collections except `units` carry `household` and use the rules
`household = @request.auth.household` (create: body household must equal the user's).

- `households`, `users` (+ `household`, `color`; no public sign-up, admin creates accounts)
- `units` (global: piece, pack, bottle, can, jar, g, kg, ml, l), `categories`, `stores`
- `item_types` (name, aliases, category, default qty/unit, track_stock, stock_state ok/low/out, restock_at)
- `item_stores` (preferred/avoid + reason), `products` (verdict, pack size, barcode, `photo`: protected file, thumbs 96x96 / 480x0), `product_stores` (price, price_seen_at, dont_buy_here)
- `list_entries`: item **or** one-off `label`; optional specific `product`; qty + unit + note; `in_cart` after Bought (Undo until Clear cart); `from_stock` when the stock screen added it.
  Unique open entry per (item, product) → adding again bumps `qty`; generic and specific entries of one item can coexist.
- `events`: append-only log (added, bought, not_needed, used_up, stock_changed, created, edited); `label` = item name at the time, `detail` = extra info (e.g. stock state); `user` must be the caller.

## Frontend structure

- `web/src/lib/data.svelte.ts`: the household store. It loads everything after login, stays live via realtime, and holds all write operations; each one also writes its `events` record. Pages read from `data` and call its methods. Don't write to PocketBase from components.
- Routes: `/` list, `/stock`, `/items`, `/log` (tab bar), `/settings` (stores & categories, via the Account sheet), `/login` (+ `/login/callback` for single sign-on). Sheets live in `web/src/lib/components/` (`Sheet`, `ItemSheet`, `EntrySheet`, `ProductSheet`, `AccountSheet`, `PlaceSheet`). A sheet opened from a sheet replaces it (`{#if}` in the parent) instead of stacking.
- Products: `products` + `product_stores` (one record per product × store: sold here with optional price, or `dont_buy_here`). `ProductSheet` edits one; `ProductList` shows them in the item and entry sheets. `data.recommend(item, store?)` picks what to buy (never don't-buy / not-here; preferred first, then lowest price per kg / l / pack); `data.hint()` is the one-line text for the entry sheet.
- List rows (spec "List"): no "added by", no tab counter. All → `data.storesFor(entry)` (stores, `.pref` = sells a preferred product / cheapest for a specific product). Store selected → `data.linesAt(entry, store)` (preferred products with prices). Specific-product entries (`entry.product`) render inverted (`.pinned`: product title, item tag); `data.setEntryProduct()` switches/merges; `data.searchProducts()` feeds product suggestions.
- Store filter on the list: `data.verdictAt(entry, store)` → here / avoid ("Better elsewhere") / elsewhere (hidden, "N more"), from item rules and product offers. `data.clearStores(entry)` = the stores an entry clearly belongs to (Buy here, preferred product, specific product, one-off's `store` via `data.entryStore()`); none → the "Other" chip, and at a store the "Other · no clear store" group. Store chips only for `data.storesWithEntries()` (plus the selected one). Only one-offs carry `list_entries.store` (`data.setEntryStore()`, Buy at chips in `EntrySheet`). "+ New store" there and under `ItemSheet`'s store rules opens `PlaceSheet` in place of the sheet (`oncreated` picks the new store; Buy here for items). Store pickers (item rules, product stores, Buy at chips) use `data.topStores(keep, expanded, first?)`: `data.storesByUse` order (items bought there), top five + stores set/touched in the sheet, rest behind "Show N more". The selected store lives in `localStorage` (per device) and is passed to `data.bought()` so purchases log their store.
- Product photos: `data.photoUrl(product, size)` builds the URL with `data.fileToken` (protected files). Tokens expire after a few minutes, so every `<img>` of a photo has `onerror={() => data.refreshFileToken()}`. `lib/photo.ts` shrinks a picked photo to 1024 px JPEG before `saveProduct` uploads it (`draft.photo`: File = upload, null = remove).
- Suggestion strip (spec "Recommendations"): `data.purchases` holds the bought / undo-bought events of the last 400 days (loaded at start, live via the `events` subscription and `#log`). `data.suggestions(store)` returns "usually bought now" (rules in `lib/rhythm.ts`, pure and tested without a browser in `tests/rhythm.spec.ts`) and "low at home"; `data.fitsStore()` limits both to the selected store. "×" hides a suggestion per device until tomorrow (`localStorage`).
- Items without an existing category belong to "Other" (`data.groupByCategory`); deleting a category clears it on its items.
- Auth (`web/src/lib/auth.svelte.ts`): login, logout, password change, single sign-on (spec "Sign-in"). A revoked session isn't a 401 in PocketBase (requests just run as a guest), so the app re-checks the session (`auth.refresh()`) after a failed action and when it comes back to the foreground.
- Sign-in modes come from the server, never from the frontend build: `pb/pb_hooks/auth.pb.js` + `lib/auth-config.js` apply `OIDC_*` and `PASSWORD_LOGIN` from the environment to the `users` collection at every `serve` (generic `oidc` provider with PKCE; nothing set = password only; `PASSWORD_LOGIN=off` ignored with a warning unless the provider is fully configured). The hook runs the migrations itself first, because `serve` applies them only after bootstrap. Settings from env belong there, not in a migration. `auth.loadMethods()` reads the users auth-methods endpoint; the login page and `AccountSheet` ("Change password" only while password sign-in is on) render from `auth.methods`.
- Single sign-on is a full-page redirect (no popup / realtime flow, so no `/api/oauth2-redirect`): `auth.startSignOn()` stores state + PKCE verifier in `localStorage` (single use, 10 min; survives Android killing the installed app) and leaves for the provider; `/login/callback` calls `auth.finishSignOn()` (checks state, `authWithOAuth2Code`) and goes back to `/login?signon=<reason>` on failure (`cancelled`, `no-account` = 403, `provider`, `state`, `offline`). The layout treats `/login/callback` like `/login`.
- The OIDC hook also marks a matched, unverified account verified before linking: PocketBase would otherwise reset its password (anti pre-hijacking, irrelevant without sign-up). `web/tests/oidc.spec.ts` covers this. Tests for the modes run via `scripts/e2e-oidc.sh` (mock provider `scripts/mock-oidc.mjs`, `E2E_AUTH=both|off|guard`); the normal run is the password-only default.
- Shared styles (tokens, `.group`/`.row`, `.seg`, `.sheet`, …) are in `web/src/app.css`, taken from the prototype. Errors go through `attempt()` and show as a toast.

## Security (see deploy/README.md → "Security model")

- **Auth token:** PocketBase SDK default, `localStorage` + `Authorization` header (`web/src/lib/pb.ts`). No auth cookies, so no CSRF surface. Don't switch to cookie auth without adding CSRF protection.
- **XSS is the main browser risk** (it could read the token): never render user data with `{@html}`, and keep the CSP in `web/vite.config.ts` strict (no new script origins, no `unsafe-eval`). The e2e suite fails on CSP violations.
- **Every new collection** gets the household rules (see Data model). Admin-only features don't go in the app; the admin uses the PocketBase dashboard via SSH tunnel.
- **Trusted proxy:** PocketBase trusts `X-Real-IP` (seed migration). Only safe while nginx is the single way in and the container binds to 127.0.0.1.
- **Bumping PocketBase:** update `PB_VERSION` and both `PB_SHA256_*` in `Dockerfile` (from the release's `checksums.txt`) and `PB_VERSION` in CI. Dependabot doesn't track it.
- **nginx template** (`deploy/nginx/`) is an allow-list: only `/api/collections/<the app's collections>/`, `/api/files/`, `/api/realtime` and `/api/health` reach PocketBase, every other `/api/` path is a 404. Never go back to blocking admin paths by name: PocketBase also accepts a collection's id and any letter case. **A new collection must be added to the list** in the template; `scripts/nginx-test.sh` (CI) fails if one is missing. Keep that test in step with the template.
- **Passwords:** the server enforces the minimum length (`users` 10, `_superusers` 12; migration `1794640000`). Keep `MIN` in `AccountSheet.svelte` equal to the `users` value.
- **Single sign-on:** never open sign-up (`users.createRule` stays null); OIDC only links to existing accounts, by an email the provider marks verified (`email_verified`), so the operator must trust the provider's emails. Never let the hook touch `_superusers`. Keep `PASSWORD_LOGIN=off` enforced by the server (`passwordAuth.enabled`), not only hidden in the UI, and keep the lock-out guard. The login uses only `/api/collections/users/auth-methods` and `/auth-with-oauth2` (already on the nginx allow-list); `/api/oauth2-redirect` stays a 404, and the CSP needs nothing new (the provider is a navigation, the code exchange happens on the server). Don't render the provider `logo` from auth-methods (raw SVG).

## Conventions

- **Schema changes = new migration files.** Never edit a migration that has been merged; add a new one. Keep `web/src/lib/types.ts` in sync. Settings that come from the environment (sign-in) are applied by `pb/pb_hooks/auth.pb.js` at start, not by a migration. That hook calls `runAllMigrations()` before applying them; it runs the same migration files `serve` would run a moment later, it doesn't change the schema itself.
- **Bought ≠ Not needed:** only Bought counts as a purchase. Every user action writes an `events` record.
- Keep UI phone-first, one-handed, and big tap targets. Colors and tokens are in `web/src/app.css`, matching the prototype.
- English UI strings for now. Plain CSS in components, no UI framework.
- Work on branches, open PRs against `main`. CI must be green.
- **Spec sync:** the spec, the prototype and the code stay in sync. A PR that changes behaviour or the data model also updates the spec, and the prototype if it's affected. Log every change in the spec's "Prototype sync log", and refresh the snapshots in `docs/` in the same PR.
