import { assert, assertEquals, assertStringIncludes } from '@std/assert';

import { ForeignPort } from '@/lib/servers.ts';

import { Push } from './push.ts';
import { handler, message, newRequests } from './server.ts';

const get = (path: string, servers?: () => Promise<unknown>) =>
   handler(new Request(`http://127.0.0.1:4965${path}`), servers && { servers });

Deno.test('serves the app shell', async () => {
   for (
      const [path, type] of [
         ['/', 'text/html'],
         ['/app.css', 'text/css'],
         ['/app.js', 'text/javascript'],
         ['/sw.js', 'text/javascript'],
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

const server = {
   port: 4966,
   pid: 1,
   repo: '/home/u/repo',
   target: '.',
   label: 'uncommitted',
   comments: 0,
   url: '',
   started: 0,
   request: null,
};

Deno.test('notifies about requests it has not seen, including repeated ones', () => {
   const asked = (requested: number, message = '') => ({ message, requested, done: null });
   const plain = { ...server, port: 4968, pid: 3 };
   const old = { ...server, request: asked(10) };
   const again = { ...server, port: 4967, pid: 2, request: asked(20, 'check the parser') };
   const known = new Map([['4966:1', 10], ['4967:2', 15]]);
   assertEquals(newRequests(known, [plain, old, again]), [again]);
   assertEquals(message(again, 2), { title: 'repo · uncommitted', body: 'check the parser', url: '/#4967', badge: 2 });
   assertEquals(message(old, 1).body, 'Review requested');
});

Deno.test('marks a review done', async () => {
   const done = (port: number) => Promise.resolve(port === 4966);
   const post = (port: number) =>
      handler(new Request(`http://127.0.0.1:4965/api/servers/${port}/done`, { method: 'POST' }), { done });
   assertEquals((await post(4966)).status, 204);
   assertEquals((await post(4967)).status, 404);
});

Deno.test('hands out the push key and saves subscriptions', async () => {
   const dir = await Deno.makeTempDir();
   try {
      const push = new Push(dir);
      const post = (body: unknown) =>
         handler(
            new Request('http://127.0.0.1:4965/api/push/subscriptions', { method: 'POST', body: JSON.stringify(body) }),
            { push },
         );
      const { key } = await (await handler(new Request('http://127.0.0.1:4965/api/push/key'), { push })).json();
      assertEquals(key, JSON.parse(await Deno.readTextFile(`${dir}/vapid.json`)).publicKey);

      const subscription = { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } };
      assertEquals((await post(subscription)).status, 201);
      assertEquals((await post(subscription)).status, 201);
      assertEquals((await post({ endpoint: 'http://insecure' })).status, 400);
      assertEquals(JSON.parse(await Deno.readTextFile(`${dir}/subscriptions.json`)), [subscription]);
   } finally {
      await Deno.remove(dir, { recursive: true });
   }
});

Deno.test('sends to every subscription and drops the ones that are gone', async () => {
   const dir = await Deno.makeTempDir();
   try {
      const sent: string[] = [];
      const push = new Push(dir, (s, payload) => {
         sent.push(`${s.endpoint} ${payload}`);
         return s.endpoint.endsWith('gone') ? Promise.reject({ statusCode: 410 }) : Promise.resolve();
      });
      for (const endpoint of ['https://push.example/kept', 'https://push.example/gone']) {
         await push.subscribe({ endpoint, keys: { p256dh: 'p', auth: 'a' } });
      }
      await push.notify(message(server, 1));
      assertEquals(sent.length, 2);
      assertStringIncludes(sent[0], '"url":"/#4966"');
      const left = JSON.parse(await Deno.readTextFile(`${dir}/subscriptions.json`));
      assertEquals(left.map((s: { endpoint: string }) => s.endpoint), ['https://push.example/kept']);
   } finally {
      await Deno.remove(dir, { recursive: true });
   }
});

Deno.test('stops a review port and reports what happened', async () => {
   const stop = (port: number) =>
      port === 4967 ? Promise.reject(new ForeignPort('held by something else')) : Promise.resolve(port === 4966);
   const post = (port: number) =>
      handler(new Request(`http://127.0.0.1:4965/api/servers/${port}/stop`, { method: 'POST' }), { stop });
   assertEquals((await post(4966)).status, 204);
   assertEquals((await post(4968)).status, 404);
   assertEquals((await post(4967)).status, 409);
   assertEquals((await post(22)).status, 400);
});
