const env = (name: string) => Deno.env.get(name);

export const DIFIT_VERSION = '5.0.12';

export const ROOT_DIR = Deno.realPathSync(`${import.meta.dirname}/..`);

export const DEFAULT_PORTS = '4966-4979';
export const DEFAULT_WEB_PORT = 4965;

const [first, last] = (env('DIFIT_HUB_PORTS') ?? DEFAULT_PORTS).split('-').map(Number);
export const PORTS = Array.from({ length: last - first + 1 }, (_, i) => first + i);
export const PORT_RANGE = `${first}-${last}`;

export const WEB_PORT = Number(env('DIFIT_HUB_WEB_PORT') ?? DEFAULT_WEB_PORT);

export const STATE_DIR = `${env('XDG_STATE_HOME') ?? `${env('HOME')}/.local/state`}/difit-hub`;

export const UNIT = 'difit-hub.service';
export const UNIT_DIR = `${env('XDG_CONFIG_HOME') ?? `${env('HOME')}/.config`}/systemd/user`;
export const UNIT_PATH = `${UNIT_DIR}/${UNIT}`;
