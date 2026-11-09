import { WEB_PORT } from '@/lib/config.ts';
import { listServers } from '@/lib/servers.ts';

const files: Record<string, [string, string]> = {
   '/': ['index.html', 'text/html; charset=utf-8'],
   '/app.css': ['app.css', 'text/css; charset=utf-8'],
   '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
   '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
   '/icon-180.png': ['icon-180.png', 'image/png'],
   '/icon-192.png': ['icon-192.png', 'image/png'],
   '/icon-512.png': ['icon-512.png', 'image/png'],
};

export async function handler(req: Request, servers: () => Promise<unknown> = listServers): Promise<Response> {
   const { pathname } = new URL(req.url);

   if (pathname === '/api/servers') {
      try {
         return Response.json(await servers(), { headers: { 'cache-control': 'no-store' } });
      } catch (e) {
         return new Response(String(e), { status: 500 });
      }
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

if (import.meta.main) {
   Deno.serve({ hostname: '127.0.0.1', port: WEB_PORT }, (req) => handler(req));
}
