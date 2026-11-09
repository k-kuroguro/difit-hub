import { createRequire } from 'node:module';

import { initWasm, Resvg } from '@resvg/resvg-wasm';

const require = createRequire(import.meta.url);
await initWasm(await Deno.readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));

const dir = new URL('../web/public/', import.meta.url);
const svg = await Deno.readTextFile(new URL('icon.svg', dir));
for (const size of [180, 192, 512]) {
   const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
   await Deno.writeFile(new URL(`icon-${size}.png`, dir), png);
}
