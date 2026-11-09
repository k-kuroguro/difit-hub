import { assert, assertEquals, assertStringIncludes } from '@std/assert';

import { handler } from './server.ts';

const get = (path: string, servers?: () => Promise<unknown>) =>
   handler(new Request(`http://127.0.0.1:4965${path}`), servers);

Deno.test('serves the app shell', async () => {
   for (
      const [path, type] of [
         ['/', 'text/html'],
         ['/app.css', 'text/css'],
         ['/app.js', 'text/javascript'],
         ['/manifest.webmanifest', 'application/manifest+json'],
      ]
   ) {
      const res = await get(path);
      assertEquals(res.status, 200, path);
      assertStringIncludes(res.headers.get('content-type')!, type);
      await res.body?.cancel();
   }
});

Deno.test('every icon the manifest and page name is a PNG', async () => {
   const manifest = JSON.parse(await (await get('/manifest.webmanifest')).text());
   const page = await (await get('/')).text();
   const paths = [
      ...manifest.icons.map((i: { src: string }) => i.src),
      page.match(/apple-touch-icon" href="([^"]+)"/)![1],
   ];
   for (const path of paths) {
      const res = await get(path);
      assertEquals(res.status, 200, path);
      const bytes = new Uint8Array(await res.arrayBuffer());
      assertEquals([...bytes.slice(1, 4)], [0x50, 0x4e, 0x47], path);
   }
});

Deno.test('passes the server list through', async () => {
   const list = [{ port: 4966, repo: '/home/u/repo', target: '.', comments: 2, url: 'https://h:4966', started: 0 }];
   const res = await get('/api/servers', () => Promise.resolve(list));
   assertEquals(res.headers.get('cache-control'), 'no-store');
   assertEquals(await res.json(), list);
});

Deno.test('reports a failing list as 500', async () => {
   const res = await get('/api/servers', () => Promise.reject(new Error('boom')));
   assertEquals(res.status, 500);
   assertStringIncludes(await res.text(), 'boom');
});

Deno.test('does not serve anything else', async () => {
   for (const path of ['/server.ts', '/icon-64.png', '/../LICENSE', '/public/index.html']) {
      const res = await get(path);
      assertEquals(res.status, 404, path);
      await res.body?.cancel();
   }
});

Deno.test('embedded Octicons are credited', async () => {
   const page = await (await get('/')).text();
   assert(page.includes('<symbol') === page.includes('Primer Octicons'));
   const appIcon = await Deno.readTextFile(new URL('./public/icon.svg', import.meta.url));
   assertStringIncludes(appIcon, 'Primer Octicons');
   const notices = await Deno.readTextFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url));
   assertStringIncludes(notices, 'Copyright (c) 2026 GitHub Inc.');
});
