import $ from '@david/dax';

import { PORT_RANGE, ROOT_DIR, UNIT, UNIT_DIR, UNIT_PATH, WEB_PORT } from '@/lib/config.ts';
import { publish, unpublish, urlOf } from '@/lib/tailscale.ts';

export async function renderUnit(): Promise<string> {
   const template = await Deno.readTextFile(`${ROOT_DIR}/systemd/${UNIT}`);
   return template
      .replaceAll('@ROOT@', ROOT_DIR)
      .replaceAll('@WEB_PORT@', String(WEB_PORT))
      .replaceAll('@PORTS@', PORT_RANGE);
}

const read = (path: string) => Deno.readTextFile(path).catch(() => undefined);
const isSymlink = (path: string) => Deno.lstat(path).then((s) => s.isSymlink, () => false);

export async function ensureService(): Promise<void> {
   const unit = await renderUnit();
   if (await isSymlink(UNIT_PATH) || await read(UNIT_PATH) !== unit) {
      await Deno.mkdir(UNIT_DIR, { recursive: true });
      await Deno.remove(UNIT_PATH).catch(() => {});
      await Deno.writeTextFile(UNIT_PATH, unit);
      await $`systemctl --user daemon-reload`;
      await $`systemctl --user try-restart ${UNIT}`.quiet().noThrow();
   }
   if ((await $`systemctl --user is-active --quiet ${UNIT}`.noThrow()).code !== 0) {
      const { code } = await $`systemctl --user enable --now ${UNIT}`.quiet().noThrow();
      if (code !== 0) console.error(`could not start ${UNIT}; see \`journalctl --user -u ${UNIT}\``);
   }
   await publish(WEB_PORT).catch(() => {});
   console.error(`all reviews: ${await urlOf(WEB_PORT)}/`);
}

export async function removeService(): Promise<void> {
   if (await read(UNIT_PATH) !== undefined || await isSymlink(UNIT_PATH)) {
      await $`systemctl --user disable --now ${UNIT}`.quiet().noThrow();
      await Deno.remove(UNIT_PATH);
      await $`systemctl --user daemon-reload`;
      await $`systemctl --user reset-failed ${UNIT}`.quiet().noThrow();
   }
   await unpublish(WEB_PORT);
}
