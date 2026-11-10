import $ from '@david/dax';
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { delay } from '@std/async';

const bin = new URL('../bin/difit', import.meta.url).pathname;
const mocks = new URL('./mocks', import.meta.url).pathname;

interface Fixture {
   dir: string;
   repo: string;
   env: Record<string, string>;
}

async function fixture(): Promise<Fixture> {
   const dir = await Deno.makeTempDir();
   const repo = `${dir}/repo`;
   await $`git init -q ${repo}`;
   for (const line of ['one', 'two']) {
      await Deno.writeTextFile(`${repo}/a.txt`, `${line}\n`, { append: true });
      await $`git -C ${repo} add a.txt`;
      await $`git -C ${repo} -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q -m ${line}`;
   }
   await Deno.writeTextFile(`${repo}/a.txt`, 'three\n', { append: true });
   await Deno.writeTextFile(`${dir}/served`, '');
   const env = {
      DIFIT_HUB_PORTS: '5966-5969',
      DIFIT_HUB_WEB_PORT: '5965',
      XDG_CONFIG_HOME: `${dir}/config`,
      XDG_STATE_HOME: `${dir}/state`,
      MOCK_LOG: `${dir}/calls.log`,
      MOCK_SERVED: `${dir}/served`,
      PATH: `${mocks}:${Deno.env.get('PATH')}`,
   };
   return { dir, repo, env };
}

const difit = (f: Fixture, ...args: string[]) =>
   $`${bin} ${args}`.cwd(f.repo).env(f.env).noThrow().stdout('piped').stderr('piped');
const served = async (f: Fixture) => (await Deno.readTextFile(`${f.dir}/served`)).split('\n').filter(Boolean);

async function withFixture(fn: (f: Fixture) => Promise<void>) {
   const f = await fixture();
   try {
      await fn(f);
   } finally {
      await difit(f, 'stop', '--all');
      await Deno.remove(f.dir, { recursive: true });
   }
}

Deno.test("--help shows the wrapper's help, then difit's", () =>
   withFixture(async (f) => {
      const res = await difit(f, '--help');
      assertEquals(res.code, 0);
      assert(res.stdout.startsWith('Usage: difit ls|stop|uninstall'), res.stdout);
      assertStringIncludes(res.stdout, '  uninstall  ');
      assert(res.stdout.indexOf('DIFIT_HUB_WEB_PORT') < res.stdout.indexOf('Usage: difit [options]'));
   }));

Deno.test('ls with no servers prints only the header, and [] as JSON', () =>
   withFixture(async (f) => {
      const table = await difit(f, 'ls');
      assertEquals(table.code, 0);
      assertEquals(table.stdout, 'PORT\tCOMMENTS\tREVIEW\tREPO\tTARGET\tURL\n');
      assertEquals(JSON.parse((await difit(f, 'ls', '--json')).stdout), []);
   }));

Deno.test('stop on an idle port is a no-op', () =>
   withFixture(async (f) => {
      const res = await difit(f, 'stop', '--port', '5966');
      assertEquals(res.code, 0);
      assertStringIncludes(res.stderr, 'no server on port 5966');
   }));

Deno.test('stop refuses a port held by something else', () =>
   withFixture(async (f) => {
      const other = Deno.serve({ hostname: '127.0.0.1', port: 5967, onListen() {} }, () => new Response());
      try {
         const res = await difit(f, 'stop', '--port', '5967');
         assertEquals(res.code, 1);
         assertStringIncludes(res.stderr, 'non-difit process');
      } finally {
         await other.shutdown();
      }
   }));

Deno.test('start, list, comment, and stop reviews', () =>
   withFixture(async (f) => {
      let res = await difit(f, '.', '--background', '--include-untracked');
      assertEquals(res.code, 0, res.stderr);
      assertStringIncludes(res.stdout, '"port":5966');
      assertStringIncludes(res.stdout, '"url":"https://host.example.ts.net:5966"');
      assertEquals((await served(f)).sort(), ['5965', '5966']);

      const unit = await Deno.readTextFile(`${f.env.XDG_CONFIG_HOME}/systemd/user/difit-hub.service`);
      assertStringIncludes(unit, 'Environment=DIFIT_HUB_WEB_PORT=5965');
      assertStringIncludes(unit, 'Environment=DIFIT_HUB_PORTS=5966-5969');
      assert(!/@(ROOT|WEB_PORT|PORTS)@/.test(unit), unit);

      res = await difit(f, 'HEAD', '--background');
      assertStringIncludes(res.stdout, '"port":5967');

      res = await difit(f, '--port', '5966', 'HEAD', '--background');
      assertEquals(res.code, 1);
      assertStringIncludes(res.stderr, 'port 5966 is in use');

      res = await difit(f, 'request', '--port', '5966', 'check', 'a.txt');
      assertEquals(res.code, 0, res.stderr);
      assertEquals((await difit(f, 'request', '--port', '5968')).code, 1);

      const thread = { type: 'thread', filePath: 'a.txt', position: { side: 'new', line: 3 }, body: 'looks off' };
      assertEquals((await difit(f, 'comment', 'add', '--port', '5966', JSON.stringify(thread))).code, 0);
      const list = JSON.parse((await difit(f, 'ls', '--json')).stdout);
      assertEquals(list.length, 2);
      const first = list.find((s: { port: number }) => s.port === 5966);
      assertEquals([first.target, first.comments, first.request.message, first.request.done], [
         '.',
         1,
         'check a.txt',
         null,
      ]);

      const exec = unit.match(/^ExecStart=\/usr\/bin\/env deno (.*)$/m)![1].split(' ');
      const web = new Deno.Command(Deno.execPath(), { args: exec, env: f.env, stdout: 'null', stderr: 'null' })
         .spawn();
      try {
         let listed: unknown[] = [];
         for (let i = 0; i < 50 && listed.length === 0; i++) {
            await delay(100);
            const answer = await fetch('http://127.0.0.1:5965/api/servers').catch(() => undefined);
            if (!answer) continue;
            if (!answer.ok) throw new Error(await answer.text());
            listed = await answer.json();
         }
         assertEquals(listed.length, 2);

         // The user marks the requested review done from the web app.
         const done = await fetch('http://127.0.0.1:5965/api/servers/5966/done', { method: 'POST' });
         assertEquals(done.status, 204);
         const after = JSON.parse((await difit(f, 'ls', '--json')).stdout);
         assert(after.find((s: { port: number }) => s.port === 5966).request.done !== null);

         // Stopping from the web app frees the port and unpublishes it.
         const stopped = await fetch('http://127.0.0.1:5965/api/servers/5967/stop', { method: 'POST' });
         assertEquals(stopped.status, 204);
         assertEquals(JSON.parse((await difit(f, 'ls', '--json')).stdout).map((s: { port: number }) => s.port), [5966]);
         assert(!(await served(f)).includes('5967'));
      } finally {
         web.kill();
         await web.status;
      }

      res = await difit(f, 'stop', '--port', '5966');
      assertEquals(res.code, 0);
      assertStringIncludes(res.stdout, 'looks off');
      assert(!(await served(f)).includes('5966'));

      res = await difit(f, 'stop');
      assertEquals(res.code, 1);
      assertStringIncludes(res.stderr, 'usage: difit stop');

      await difit(f, 'stop', '--all');
      assertEquals(JSON.parse((await difit(f, 'ls', '--json')).stdout), []);
   }));

Deno.test('uninstall stops the servers and removes the service and its ports', () =>
   withFixture(async (f) => {
      await difit(f, '.', '--background');
      const unit = `${f.env.XDG_CONFIG_HOME}/systemd/user/difit-hub.service`;
      assert(await Deno.stat(unit));

      const res = await difit(f, 'uninstall');
      assertEquals(res.code, 0, res.stderr);
      assert(!await Deno.stat(unit).then(() => true, () => false));
      assertStringIncludes(await Deno.readTextFile(f.env.MOCK_LOG), 'systemctl --user disable --now difit-hub.service');
      assertEquals(await served(f), []);
      assertEquals(JSON.parse((await difit(f, 'ls', '--json')).stdout), []);

      assertEquals((await difit(f, 'uninstall')).code, 0);
   }));
