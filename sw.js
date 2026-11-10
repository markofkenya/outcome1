/* Outcome1 service worker
   Keeps a copy of the app on the phone so it opens instantly and works without signal.
   The page is shown from the saved copy, then checked against the server in the background;
   if you've uploaded a new version, the app offers a Refresh. Nothing here needs editing when
   you update the app. Sign-in and sync traffic to Firebase is never touched. */
const APP = 'o1-app-v1', LIBS = 'o1-libs-v1';
const LIB_HOSTS = /^https:\/\/(www\.gstatic\.com\/firebasejs\/|fonts\.googleapis\.com\/|fonts\.gstatic\.com\/|cdnjs\.cloudflare\.com\/)/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (![APP, LIBS].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (req.mode === 'navigate') e.respondWith(page(e));
    else e.respondWith(fresh(req, APP));            // icons and manifest
    return;
  }
  if (LIB_HOSTS.test(req.url)) e.respondWith(fresh(req, LIBS));   // Firebase code, fonts, report libraries
  // anything else (Firebase database, sign-in) goes straight to the network
});

// A note that a newer version is saved but not yet on screen, so a page that opens late still hears about it
const FLAG = () => self.registration.scope + '__o1-update-ready';
async function setFlag(on) { const c = await caches.open(APP); if (on) await c.put(FLAG(), new Response('1')); else await c.delete(FLAG()); }
async function hasFlag() { const c = await caches.open(APP); return !!(await c.match(FLAG())); }
self.addEventListener('message', e => {
  if (!e.data) return;
  if (e.data.type === 'o1-hello' && e.source)
    e.waitUntil(hasFlag().then(f => { if (f) e.source.postMessage({ type: 'o1-update' }); }));
  // the app came back on screen: look for a newer version without waiting for a fresh open
  if (e.data.type === 'o1-check' && e.data.url) e.waitUntil(checkPage(e.data.url));
});
async function checkPage(u) {
  const key = new URL(u); if (key.origin !== location.origin) return; key.search = ''; key.hash = '';
  const cache = await caches.open(APP), saved = await cache.match(key.href);
  if (!saved) return;
  try {
    const res = await fetch(key.href, { cache: 'no-cache', credentials: 'same-origin' });
    if (!res.ok || res.redirected || res.type !== 'basic') return;
    const text = await res.clone().text(), before = await saved.text();
    if (before !== text) { await cache.put(key.href, res); await setFlag(true); tell({ type: 'o1-update' }); }
  } catch (err) {}
}

// The app page: saved copy first, then check for a newer one
async function page(e) {
  const cache = await caches.open(APP);
  const key = new URL(e.request.url); key.search = ''; key.hash = '';
  const saved = await cache.match(key.href);
  const savedCopy = saved ? saved.clone() : null;   // the original goes to the screen; compare against this copy
  if (saved) await setFlag(false);   // this load shows the newest copy we have
  const check = (async () => {
    try {
      const res = await fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' });
      if (!res.ok || res.redirected || res.type !== 'basic') return saved ? null : res;
      const text = await res.clone().text();
      const before = savedCopy ? await savedCopy.text() : null;
      await cache.put(key.href, res.clone());
      if (before !== null && before !== text) { await setFlag(true); tell({ type: 'o1-update' }); }
      return res;
    } catch (err) { return null; }
  })();
  if (saved) { e.waitUntil(check); return saved; }
  const res = await check;
  return res || new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Outcome1</title>' +
    '<body style="font-family:system-ui,sans-serif;background:#F4F3EE;color:#1E1E1E;padding:48px 24px;text-align:center">' +
    '<h2>You’re offline</h2><p>Open Outcome1 once with a connection so it can be saved on this phone.</p></body>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// Everything else: saved copy straight away, refreshed in the background
async function fresh(req, name) {
  const cache = await caches.open(name);
  const saved = await cache.match(req);
  const update = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (saved) return saved;
  return (await update) || Response.error();
}

async function tell(msg) {
  for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage(msg);
}
