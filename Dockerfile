# syntax=docker/dockerfile:1

# ---- 1. Build the SvelteKit PWA ------------------------------------------
# Runs on the build machine's own platform: the output is plain HTML/JS/CSS,
# the same for every target. Building it under QEMU for arm64 crashes Vite 8's
# native bundler (rolldown) with "Illegal instruction" and is slow anyway.
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /web
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml* ./
RUN if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; else pnpm install; fi
COPY web/ ./
RUN pnpm build

# ---- 2. PocketBase runtime (also used by compose.dev.yml) ----------------
FROM alpine:3.24 AS pocketbase
# When bumping PB_VERSION, update both checksums from the release's
# checksums.txt (and PB_VERSION in .github/workflows/ci.yml).
ARG PB_VERSION=0.40.6
ARG PB_SHA256_AMD64=0e1f609158ed945f809f8a02ae012aa0427129c66ebb63c1aee76f2c0309373f
ARG PB_SHA256_ARM64=d22c66ceb67ca92b7d767f36d826e848a276bcfa3c197ead20bf87c42208984f
ARG TARGETARCH=amd64
RUN apk add --no-cache ca-certificates tzdata wget unzip \
 && case "$TARGETARCH" in \
      amd64) sum="$PB_SHA256_AMD64" ;; \
      arm64) sum="$PB_SHA256_ARM64" ;; \
      *) echo "unsupported arch: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && wget -q -O /tmp/pb.zip \
    "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" \
 && echo "$sum  /tmp/pb.zip" | sha256sum -c - \
 && unzip -q /tmp/pb.zip pocketbase -d /pb \
 && rm /tmp/pb.zip \
 && apk del unzip \
 && addgroup -S -g 10001 pb \
 && adduser -S -D -H -u 10001 -G pb pb \
 && mkdir -p /pb/pb_data \
 && chown pb:pb /pb/pb_data
WORKDIR /pb
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -q -O /dev/null http://127.0.0.1:8090/api/health || exit 1
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb/pb_data", \
     "--migrationsDir=/pb/pb_migrations", "--hooksDir=/pb/pb_hooks"]

# ---- 3. Production image: PocketBase + migrations + built app ------------
FROM pocketbase AS app
COPY pb/pb_migrations /pb/pb_migrations
COPY pb/pb_hooks /pb/pb_hooks
COPY --from=web /web/build /pb/pb_public
# Runs as an unprivileged user; only pb_data is writable for it.
USER pb:pb
VOLUME /pb/pb_data
# Settings (SMTP / S3 credentials) are encrypted at rest when the env var
# PB_ENCRYPTION_KEY holds 32 characters; when it's empty they're stored plain.
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb/pb_data", \
     "--migrationsDir=/pb/pb_migrations", "--hooksDir=/pb/pb_hooks", "--publicDir=/pb/pb_public", \
     "--dev=false", "--automigrate=false", "--hooksWatch=false", \
     "--encryptionEnv=PB_ENCRYPTION_KEY"]
