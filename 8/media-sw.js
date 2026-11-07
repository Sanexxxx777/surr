// Scope-bound, stale-while-revalidate cover and medal cache. Never cache pages, scripts or user data.
const base = new URL('./', self.location.href);
const coverPath = new URL('art/covers/', base).pathname;
const artPath = new URL('art/', base).pathname;
const illustrationFolders = ['nemesis/', 'games/', 'paintings/'].map((folder) => artPath + folder);
const cacheName = `surr-covers-v1:${base.pathname}`;
const pending = new Map();
function isArtwork(url) {
  if (url.origin !== base.origin || !url.pathname.endsWith('.webp')) return false;
  return url.pathname.startsWith(coverPath) || illustrationFolders.some((path) => url.pathname.startsWith(path))
    || (url.pathname.startsWith(artPath) && /^[A-Z][0-9]\.webp$/.test(url.pathname.slice(artPath.length)));
}
const cached = async (url) => {
  try { return await (await caches.open(cacheName)).match(url); } catch { return undefined; }
};
function refresh(url) {
  if (!pending.has(url)) {
    const request = fetch(url).then(async (response) => {
      if (response.ok && response.headers.get('content-type')?.startsWith('image/')) {
        try { await (await caches.open(cacheName)).put(url, response.clone()); } catch { /* Storage can be full or disabled. */ }
      }
      return response;
    }).finally(() => pending.delete(url));
    pending.set(url, request);
  }
  return pending.get(url).then((response) => response.clone());
}
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !isArtwork(new URL(event.request.url))) return;
  const fresh = refresh(event.request.url);
  event.waitUntil(fresh.catch(() => undefined));
  event.respondWith(cached(event.request.url).then((hit) => hit || fresh));
});
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'warm-covers' || !Array.isArray(event.data.urls)) return;
  const urls = [...new Set(event.data.urls.filter((value) => {
    try { return typeof value === 'string' && isArtwork(new URL(value)); } catch { return false; }
  }))].slice(0, 48);
  // Two requests at a time keep prefetching from competing with navigation and visible images.
  const warm = async () => {
    for (let url; (url = urls.shift());) {
      if (!await cached(url)) await refresh(url).catch(() => undefined);
    }
  };
  event.waitUntil(Promise.all([warm(), warm()]));
});
