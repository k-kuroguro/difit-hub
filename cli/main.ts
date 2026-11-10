import { delay } from '@std/async';

import { optValue } from '@/lib/args.ts';
import { DEFAULT_PORTS, DEFAULT_WEB_PORT, DIFIT_VERSION, PORT_RANGE, PORTS, WEB_PORT } from '@/lib/config.ts';
import { listeners, listServers, runningServers, serverPid, serverRoot, stopServer } from '@/lib/servers.ts';
import { readRequests, requestReview, serverKey } from '@/lib/requests.ts';
import { publish, unpublish, urlOf } from '@/lib/tailscale.ts';

import { ensureService, removeService } from './service.ts';

const help = `Usage: difit ls|request|wait|stop|uninstall [options]

difit wrapper that runs difit and publishes each review on the tailnet

Commands:
  ls [--json]          list running reviews
  request --port N [message]
                       ask the user to review it, with a notification
  wait --port N [--timeout S]
                       wait until the user is done, then print the comments
  stop --port N|--all  print a server's remaining comments, then stop it
  uninstall            stop every server and remove the systemd service
  --hub                print "difit-hub", to tell this wrapper from difit

Environment:
  DIFIT_HUB_PORTS      ports for reviews (default: "${DEFAULT_PORTS}")
  DIFIT_HUB_WEB_PORT   port of the review list (default: ${DEFAULT_WEB_PORT})

difit's own help:
`;

class Exit extends Error {
   constructor(readonly code: number, message?: string) {
      super(message);
   }
}

const difitArgs = (args: string[]) => ['run', '--allow-all', '--quiet', `npm:difit@${DIFIT_VERSION}`, ...args];

async function difit(args: string[]): Promise<number> {
   const command = new Deno.Command(Deno.execPath(), {
      args: difitArgs(args),
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
   });
   return (await command.spawn().status).code;
}

const isFree = async (port: number) => (await listeners(port)) === '';

async function stopPort(port: number): Promise<void> {
   const pid = await serverPid(port);
   if (!pid) {
      console.error(`no server on port ${port}`);
      await unpublish(port);
      return;
   }

   console.log(`== port ${port}: ${await serverRoot(pid)}`);
   await difit(['comment', 'get', '--port', String(port)]);
   await stopServer(port);
}

async function stop(args: string[]): Promise<void> {
   const port = optValue(args, '--port');
   if (port) return await stopPort(Number(port));

   if (!args.includes('--all')) throw new Exit(1, 'usage: difit stop --port N | --all');

   const servers = await runningServers();
   if (servers.size === 0) {
      console.error('no server to stop');
   }
   for (const port of servers.keys()) await stopPort(port);
}

async function ls(args: string[]): Promise<void> {
   const servers = await listServers();
   if (args.includes('--json')) {
      console.log(JSON.stringify(servers, null, 2));
      return;
   }

   const rows = [
      ['PORT', 'COMMENTS', 'REVIEW', 'REPO', 'TARGET', 'URL'],
      ...servers.map((s) => [
         String(s.port),
         String(s.comments ?? '?'),
         s.request ? (s.request.done ? 'done' : 'needed') : '',
         s.repo,
         s.target,
         s.url,
      ]),
   ];
   if (!Deno.stdout.isTerminal()) {
      for (const row of rows) console.log(row.join('\t'));
      return;
   }

   const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
   for (const row of rows) console.log(row.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd());
}

/** Asks the user to review a running server, with an optional message for them. */
async function request(args: string[]): Promise<void> {
   const port = Number(optValue(args, '--port'));
   if (!port) throw new Exit(1, 'usage: difit request --port N [message]');
   const pid = await serverPid(port);
   if (!pid) throw new Exit(1, `no server on port ${port}`);
   const message = args.filter((a, i) => a !== '--port' && args[i - 1] !== '--port').join(' ');
   const running = new Set([...await runningServers()].map(([p, id]) => serverKey(p, id)));
   await requestReview(serverKey(port, pid), message, running);
   console.error(`asked for a review of port ${port}; the phone gets a notification`);
}

/**
 * Waits until the user marks the requested review done, then prints its comments. Fails when the server stops first
 * and exits with 124, as timeout(1) does, when --timeout seconds pass.
 */
async function wait(args: string[]): Promise<number> {
   const port = Number(optValue(args, '--port'));
   if (!port) throw new Exit(1, 'usage: difit wait --port N [--timeout S]');
   const pid = await serverPid(port);
   if (!pid) throw new Exit(1, `no server on port ${port}`);
   const key = serverKey(port, pid);
   if (!(await readRequests())[key]) throw new Exit(1, `no review requested for port ${port}; see difit request`);

   const timeout = Number(optValue(args, '--timeout') ?? Infinity);
   const until = Date.now() + timeout * 1000;
   console.error(`waiting for the review of port ${port} to be done`);
   while (!(await readRequests())[key]?.done) {
      if (await serverPid(port).catch(() => undefined) !== pid) throw new Exit(1, `the server on port ${port} stopped`);
      if (Date.now() > until) throw new Exit(124, `still not reviewed after ${timeout}s`);
      await delay(2000);
   }
   return await difit(['comment', 'get', '--port', String(port)]);
}

async function uninstall(): Promise<void> {
   await stop(['--all']);
   await removeService();
   console.error(`removed the difit-hub service and unpublished ports ${WEB_PORT}, ${PORT_RANGE}`);
}

async function freePort(): Promise<number> {
   for (const port of PORTS) {
      if (await isFree(port)) return port;
   }
   throw new Exit(1, `ports ${PORT_RANGE} are all in use; see difit ls`);
}

function rewriteUrls(port: number, url: string): TransformStream<string, string> {
   const local = new RegExp(`http://(localhost|127\\.0\\.0\\.1):${port}`, 'g');

   let rest = '';
   return new TransformStream({
      transform(chunk, out) {
         const lines = (rest + chunk).split('\n');
         rest = lines.pop()!;
         for (const line of lines) out.enqueue(`${line.replace(local, url)}\n`);
      },
      flush(out) {
         if (rest) out.enqueue(rest.replace(local, url));
      },
   });
}

async function start(args: string[]): Promise<number> {
   const asked = optValue(args, '--port');
   const port = asked ? Number(asked) : await freePort();
   if (asked && !await isFree(port)) throw new Exit(1, `port ${port} is in use; see difit ls`);

   await ensureService().catch((e) => console.error(`could not set up the difit-hub service: ${e.message}`));
   const run = [...args];
   if (!args.includes('--host')) run.push('--host', '127.0.0.1');
   if (!asked) run.push('--port', String(port));
   await publish(port);

   const child = new Deno.Command(Deno.execPath(), {
      args: difitArgs(run),
      stdin: 'inherit',
      stdout: 'piped',
      stderr: 'inherit',
   }).spawn();
   let signalled = 0;
   for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
      Deno.addSignalListener(signal, () => {
         signalled = code;
         try {
            child.kill('SIGTERM');
         } catch {
            // Already gone.
         }
      });
   }
   const output = child.stdout.pipeThrough(new TextDecoderStream())
      .pipeThrough(rewriteUrls(port, await urlOf(port)))
      .pipeThrough(new TextEncoderStream())
      .pipeTo(Deno.stdout.writable, { preventClose: true });
   const { code } = await child.status;
   await output;
   if (signalled) {
      for (let i = 0; i < 20 && !await isFree(port); i++) await delay(100);
   }

   if (await isFree(port)) await unpublish(port); // With --background the server outlives difit.

   return signalled || code;
}

export async function main(args: string[]): Promise<number> {
   try {
      switch (args[0]) {
         case 'ls':
            await ls(args.slice(1));
            return 0;

         case 'stop':
            await stop(args.slice(1));
            return 0;

         case 'request':
            await request(args.slice(1));
            return 0;

         case 'wait':
            return await wait(args.slice(1));

         case 'uninstall':
            await uninstall();
            return 0;

         case '--hub':
            console.log('difit-hub');
            return 0;

         case '-h':
         case '--help':
            console.log(help);
            return await difit(['--help']);

         case 'comment':
         case '-v':
         case '--version':
            return await difit(args);

         default:
            return await start(args);
      }
   } catch (e) {
      if (e instanceof Exit) {
         if (e.message) console.error(e.message);
         return e.code;
      }

      console.error(`${e instanceof Error ? e.message : e}`);
      return 1;
   }
}
