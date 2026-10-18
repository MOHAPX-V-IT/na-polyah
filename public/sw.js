const CACHE_PREFIX = 'na-polyah-shell-';
const CACHE = CACHE_PREFIX + '__BUILD_VERSION__';
const PRECACHE = []; /*__PRECACHE__*/
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(CACHE_PREFIX) && name !== CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CACHE_STATUS') return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const results = await Promise.all(
        PRECACHE.map((url) => cache.match(url, { ignoreVary: true })),
      );
      event.ports[0]?.postMessage({
        ready: PRECACHE.length > 0 && results.every(Boolean),
        version: CACHE,
        count: PRECACHE.length,
      });
    })(),
  );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (event.request.mode === 'navigate') {
        const shell = await cache.match('/', { ignoreVary: true });
        if (!shell) return fetch(event.request);
        const html = (await shell.text()).replace(
          '</head>',
          '<meta name="offline-shell-delivery" content="service-worker"></head>',
        );
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      return (await cache.match(url.pathname, { ignoreVary: true })) || fetch(event.request);
    })(),
  );
});
