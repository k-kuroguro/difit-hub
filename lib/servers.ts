import $ from '@david/dax';

import { targetLabel, targets } from './args.ts';
import { PORTS } from './config.ts';
import { urlOf } from './tailscale.ts';

export interface Server {
   port: number;
   pid: number;
   repo: string;
   target: string;
   label: string;
   comments: number | null;
   url: string;
   started: number; // Unix seconds
}

export async function listeners(port: number): Promise<string> {
   const filter = `( sport = :${port} ) and ( src 127.0.0.1 or src 0.0.0.0 or src [::1] or src [::] )`;
   return await $`ss -ltnpH ${filter}`.stderr('null').noThrow().text();
}

const cmdline = async (pid: number) => (await Deno.readTextFile(`/proc/${pid}/cmdline`)).split('\0').slice(0, -1);
const isDifitMain = (arg: string) => /\/difit\/.*\/index\.js$/.test(arg);

export class ForeignPort extends Error {}

export async function serverPid(port: number): Promise<number | undefined> {
   const pid = Number((await listeners(port)).match(/pid=(\d+)/)?.[1]);
   if (!pid) return undefined;

   const args = await cmdline(pid);
   if (!args.some(isDifitMain)) {
      throw new ForeignPort(`port ${port} is held by a non-difit process (pid ${pid}): ${args.join(' ')}`);
   }

   return pid;
}

export async function difitPid(port: number): Promise<number | undefined> {
   try {
      return await serverPid(port);
   } catch (e) {
      if (e instanceof ForeignPort) return undefined;
      throw e;
   }
}

export async function serverArgs(pid: number): Promise<string[]> {
   const args = await cmdline(pid);
   return args.slice(args.findIndex(isDifitMain) + 1);
}

export async function gitRoot(dir: string): Promise<string> {
   return await $`git -C ${dir} rev-parse --show-toplevel`.stderr('null').noThrow().text();
}

export async function serverRoot(pid: number): Promise<string> {
   return await gitRoot(await Deno.readLink(`/proc/${pid}/cwd`));
}

export async function runningServers(): Promise<Map<number, number>> {
   const found = new Map<number, number>();
   for (const port of PORTS) {
      const pid = await difitPid(port);
      if (pid) found.set(port, pid);
   }
   return found;
}

async function commentCount(port: number): Promise<number | null> {
   try {
      const res = await fetch(`http://127.0.0.1:${port}/api/comments-json`, { signal: AbortSignal.timeout(2000) });
      return res.ok ? (await res.json()).threads.length : null;
   } catch {
      return null;
   }
}

export async function listServers(): Promise<Server[]> {
   const servers = [];
   for (const [port, pid] of await runningServers()) {
      const target = targets(await serverArgs(pid)).join(' ');
      const elapsed = Number(await $`ps -o etimes= -p ${pid}`.text());
      servers.push({
         port,
         pid,
         repo: await serverRoot(pid),
         target,
         label: targetLabel(target),
         comments: await commentCount(port),
         url: await urlOf(port),
         started: Math.floor(Date.now() / 1000) - elapsed,
      });
   }
   return servers;
}
