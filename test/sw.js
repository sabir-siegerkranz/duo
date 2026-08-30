/* DuoCards service worker — app-shell precache + offline review of already-loaded data.
 *
 * Scope notes:
 * - GET requests to Supabase REST are served stale-while-revalidate so a deck you
 *   opened while online stays reviewable offline.
 * - Writes (POST/PATCH/DELETE) are NOT intercepted here. The app has its own
 *   localStorage retry queue for review results (see persistReview/flushPending in
 *   index.html); letting the SW queue them too would risk double-applying.
 */

const VERSION = 'duocards-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
const REST_PREFIX = 'https://wmvyujfggczdyexrifkk.supabase.co/rest/v1/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // writes fall through to the network + app queue

  const url = new URL(req.url);

  // Navigations: network-first, fall back to the cached shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Supabase REST reads: stale-while-revalidate.
  if (req.url.startsWith(REST_PREFIX)) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);
        if (cached) { event.waitUntil(network); return cached; }
        const res = await network;
        if (res) return res;
        // Offline and never cached: degrade to an empty result set.
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      })
    );
    return;
  }

  // Same-origin static assets: cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        });
      })
    );
  }
});
