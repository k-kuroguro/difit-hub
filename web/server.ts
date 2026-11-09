import { delay } from '@std/async';

import { WEB_PORT } from '@/lib/config.ts';
import { listServers, type Server } from '@/lib/servers.ts';

import { Push } from './push.ts';

const files: Record<string, [string, string]> = {
   '/': ['index.html', 'text/html; charset=utf-8'],
   '/app.css': ['app.css', 'text/css; charset=utf-8'],
   '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
   '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
   '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
   '/icon-180.png': ['icon-180.png', 'image/png'],
   '/icon-192.png': ['icon-192.png', 'image/png'],
   '/icon-512.png': ['icon-512.png', 'image/png'],
};

export interface Deps {
   servers: () => Promise<unknown>;
   push: Push;
}

const defaults: Deps = { servers: listServers, push: new Push() };

export async function handler(req: Request, deps: Partial<Deps> = {}): Promise<Response> {
   const { servers, push } = { ...defaults, ...deps };
   const { pathname } = new URL(req.url);

   if (pathname === '/api/servers') {
      try {
         return Response.json(await servers(), { headers: { 'cache-control': 'no-store' } });
      } catch (e) {
         return new Response(String(e), { status: 500 });
      }
   }

   if (pathname === '/api/push/key') {
      return Response.json({ key: await push.publicKey() });
   }

   if (pathname === '/api/push/subscriptions' && req.method === 'POST') {
      const saved = await push.subscribe(await req.json().catch(() => null));
      return new Response(null, { status: saved ? 201 : 400 });
   }

   const file = files[pathname];
   if (file) {
      const [name, type] = file;
      return new Response(await Deno.readFile(new URL(`./public/${name}`, import.meta.url)), {
         headers: { 'content-type': type, 'cache-control': 'no-cache' },
      });
   }

   return new Response('not found', { status: 404 });
}

const serverKey = (s: Server) => `${s.port}:${s.pid}`;

/** The servers in `current` that are not in `known`. */
export function newServers(known: Set<string>, current: Server[]): Server[] {
   return current.filter((s) => !known.has(serverKey(s)));
}

/** The notification for a review that just started; tapping it opens that review in the web app. */
export function message(s: Server) {
   return { title: s.repo.split('/').pop() || 'difit-hub', body: `New review: ${s.label}`, url: `/#${s.port}` };
}

/** Notifies the subscribed phones about each review that starts while the web app runs. */
async function watch(push: Push): Promise<never> {
   let known: Set<string> | undefined;
   while (true) {
      try {
         const current = await listServers();
         if (known) {
            for (const s of newServers(known, current)) await push.notify(message(s));
         }
         known = new Set(current.map(serverKey));
      } catch (e) {
         console.error(e);
      }
      await delay(3000);
   }
}

if (import.meta.main) {
   Deno.serve({ hostname: '127.0.0.1', port: WEB_PORT }, (req) => handler(req));
   watch(defaults.push);
}
