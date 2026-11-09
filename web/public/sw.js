// Shows the notifications web/push.ts sends, and opens the review a tapped notification is about.

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
   const { title, body, url } = event.data.json();
   event.waitUntil(self.registration.showNotification(title, { body, tag: url, data: { url } }));
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
