/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Caches the app shell so the app opens without signal (store basements).
// API calls are never cached here; offline data sync comes in a later version.

import { self as sw } from '$app/service-worker';
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';

const CACHE = `shell-${version}`;
// Manifest paths are relative to the base path. The app sets no base path
// (it's served at /), so a leading slash makes them absolute URLs.
const SHELL = [
  ...immutable.map((f) => `/${f.path}`), // Vite output (JS, CSS)
  ...assets.map((f) => `/${f.path}`), // everything in static/
  '/'
];

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => sw.skipWaiting())
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim())
  );
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== sw.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_/')) return;

  // Page navigations: network first, fall back to the cached app shell.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(async () => (await caches.match('/')) ?? Response.error()));
    return;
  }

  // Static assets: cache first.
  event.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)));
});
