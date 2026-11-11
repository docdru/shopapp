# ShopApp

[![CI](https://github.com/docdru/shopapp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/docdru/shopapp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Image](https://img.shields.io/badge/image-ghcr.io%2Fdocdru%2Fshopapp-2496ED?logo=docker&logoColor=white)](https://github.com/docdru/shopapp/pkgs/container/shopapp)

A small self-hosted shopping list and household inventory app for the family.
It's an installable web app (PWA) for Android phones and browsers, backed by
[PocketBase](https://pocketbase.io). Changes sync live between everyone who's
shopping.

- **Spec:** [docs/spec.md](docs/spec.md) (living version: [ShopApp – Spec](https://claude.ai/artifact/DPjmRyRE4V32geGviEx4hQ))
- **Clickable prototype:** [docs/prototype/index.html](docs/prototype/index.html) (living version: [prototype](https://claude.ai/artifact/9QkWqMkrRvH2H3bqnyfAUK))

## Repository layout

| Path | What |
| --- | --- |
| `docs/` | Spec and clickable prototype (snapshots of the living versions) |
| `web/` | SvelteKit 3 + Svelte 5 + TypeScript frontend, built as a static PWA |
| `pb/pb_migrations/` | PocketBase schema and seed data as JS migrations |
| `pb/pb_hooks/` | Server-side JS hooks (empty for now) |
| `Dockerfile` | Builds the frontend and bundles it with PocketBase into one image |
| `compose.dev.yml` | Local PocketBase for development |
| `deploy/` | Production compose file, `.env` example and nginx site template |
| `.github/workflows/ci.yml` | Checks, builds, and publishes the image to ghcr.io |
| `.github/workflows/ai-review.yml`, `.github/ai-review.toml` | AI review of every PR by the shared action [docdru/ai-review](https://github.com/docdru/ai-review) (Mistral API). Needs the `MISTRAL_API_KEY` secret. The toml holds this project's review instructions, reference docs and model; it is read from `main`, so test a change with the action's `--dry-run --config` first |

## Development

Requirements: Docker, Node 22 and pnpm (`corepack enable`).

```sh
# 1. Backend: PocketBase with the repo's migrations, on http://localhost:8090
docker compose -f compose.dev.yml up -d

# 2. Create an admin and a first family member
#    Open http://localhost:8090/_/ and follow the installer link printed in
#    `docker compose -f compose.dev.yml logs`, or:
docker compose -f compose.dev.yml exec pocketbase \
  /pb/pocketbase superuser upsert you@example.com 'a-long-password' --dir /pb/pb_data
#    Then, in the dashboard: users → New record (set name, email, password,
#    household "Family", verified).

# 3. Frontend with hot reload on http://localhost:5173
cd web
pnpm install
pnpm dev
```

The Vite dev server proxies `/api` and `/_` to PocketBase, so the app always
talks to its own origin, just like in production.

Schema changes: either write a new migration in `pb/pb_migrations/`, or change
collections in the dev dashboard. PocketBase then writes the migration file for
you. Commit it either way. Production applies pending migrations on start.

Useful commands in `web/`: `pnpm check` (types and Svelte), `pnpm build`.

### End-to-end test

`web/tests/` holds Playwright tests that drive the built app against a real
PocketBase. Two family members are logged in side by side to check live sync.
CI runs them on every PR. To run them locally (with the `pocketbase` binary in
the repo root):

```sh
cd web && pnpm build && cd ..
sh scripts/e2e-setup.sh ./pocketbase     # throwaway DB on :8090 with test users
cd web && pnpm exec playwright install chromium && pnpm test:e2e
```

## Deployment

See [deploy/README.md](deploy/README.md). In short: the server runs one
container from `ghcr.io/docdru/shopapp`, bound to `127.0.0.1:8090`, and
the existing nginx serves it over HTTPS.

## License

[MIT](LICENSE). Provided as is, without warranty or liability.
