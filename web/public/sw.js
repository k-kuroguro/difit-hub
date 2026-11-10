// A copy of the app itself, so it still opens off the tailnet and can say the PC is out of reach.
const shell = ['/', '/app.css', '/app.js', '/manifest.webmanifest', '/icon-180.png', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
   event.waitUntil(caches.open('shell').then((cache) => cache.addAll(shell)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// The network comes first so changes show up at once; the copy is only for when the PC cannot be reached.
self.addEventListener('fetch', (event) => {
   const url = new URL(event.request.url);
   if (event.request.method !== 'GET' || url.origin !== self.location.origin || !shell.includes(url.pathname)) return;
   event.respondWith(
      fetch(event.request).then(async (res) => {
         if (res.ok) await (await caches.open('shell')).put(url.pathname, res.clone());
         return res;
      }).catch(async () => (await caches.match(url.pathname)) ?? Response.error()),
   );
});

self.addEventListener('push', (event) => {
   const { title, body, url, badge } = event.data.json();
   event.waitUntil(Promise.all([
      self.registration.showNotification(title, { body, tag: url, data: { url } }),
      self.navigator.setAppBadge?.(badge),
   ]));
});

self.addEventListener('notificationclick', (event) => {
   event.notification.close();
   const url = new URL(event.notification.data.url, self.location.origin).href;
   event.waitUntil((async () => {
      const [client] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (!client) return self.clients.openWindow(url);
      client.postMessage({ open: url });
      return client.focus();
   })());
});
