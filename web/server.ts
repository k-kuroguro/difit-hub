import { delay } from '@std/async';

import { PORTS, WEB_PORT } from '@/lib/config.ts';
import { markDone, serverKey } from '@/lib/requests.ts';
import { ForeignPort, listServers, type Server, serverPid, stopServer } from '@/lib/servers.ts';

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
   stop: (port: number) => Promise<boolean>;
   done: (port: number) => Promise<boolean>;
   push: Push;
}

/** Marks the review on a port as done. False when it has no request. */
async function doneReview(port: number): Promise<boolean> {
   const pid = await serverPid(port);
   return pid !== undefined && await markDone(serverKey(port, pid));
}

const defaults: Deps = { servers: listServers, stop: stopServer, done: doneReview, push: new Push() };

export async function handler(req: Request, deps: Partial<Deps> = {}): Promise<Response> {
   const { servers, stop, done, push } = { ...defaults, ...deps };
   const { pathname } = new URL(req.url);

   if (pathname === '/api/servers') {
      try {
         return Response.json(await servers(), { headers: { 'cache-control': 'no-store' } });
      } catch (e) {
         return new Response(String(e), { status: 500 });
      }
   }

   const action = pathname.match(/^\/api\/servers\/(\d+)\/(stop|done)$/);
   if (action && req.method === 'POST') {
      const port = Number(action[1]);
      if (!PORTS.includes(port)) return new Response(`port ${port} is not a review port`, { status: 400 });
      try {
         const acted = action[2] === 'stop' ? await stop(port) : await done(port);
         return new Response(null, { status: acted ? 204 : 404 });
      } catch (e) {
         return new Response(String(e), { status: e instanceof ForeignPort ? 409 : 500 });
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

/** When each server's review was last requested, by `port:pid`. */
export type Requested = Map<string, number>;

const requested = (servers: Server[]): Requested =>
   new Map(servers.flatMap((s) => s.request ? [[serverKey(s.port, s.pid), s.request.requested]] : []));

/** The servers whose review was requested, or requested again, since `known`. */
export function newRequests(known: Requested, current: Server[]): Server[] {
   return current.filter((s) => s.request && known.get(serverKey(s.port, s.pid)) !== s.request.requested);
}

/** The notification for a requested review; tapping it opens that review in the web app. */
export function message(s: Server) {
   const repo = s.repo.split('/').pop() || 'difit-hub';
   return { title: `${repo} · ${s.label}`, body: s.request?.message || 'Review requested', url: `/#${s.port}` };
}

/** Notifies the subscribed phones about each review requested while the web app runs. */
async function watch(push: Push): Promise<never> {
   let known: Requested | undefined;
   while (true) {
      try {
         const current = await listServers();
         if (known) {
            for (const s of newRequests(known, current)) await push.notify(message(s));
         }
         known = requested(current);
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
