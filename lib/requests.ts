import { STATE_DIR } from './config.ts';

export interface ReviewRequest {
   message: string;
   requested: number;
   done: number | null;
}

type Requests = Record<string, ReviewRequest>;

export const serverKey = (port: number, pid: number) => `${port}:${pid}`;

const now = () => Math.floor(Date.now() / 1000);

export function readRequests(dir = STATE_DIR): Promise<Requests> {
   return Deno.readTextFile(`${dir}/requests.json`).then((text) => JSON.parse(text), () => ({}));
}

async function write(requests: Requests, dir: string): Promise<void> {
   await Deno.mkdir(dir, { recursive: true });
   await Deno.writeTextFile(`${dir}/requests.json`, JSON.stringify(requests));
}

export async function requestReview(key: string, message: string, running: Set<string>, dir = STATE_DIR) {
   const kept = Object.entries(await readRequests(dir)).filter(([k]) => running.has(k));
   await write({ ...Object.fromEntries(kept), [key]: { message, requested: now(), done: null } }, dir);
}

export async function markDone(key: string, dir = STATE_DIR): Promise<boolean> {
   const requests = await readRequests(dir);
   if (!requests[key]) return false;

   requests[key].done = now();
   await write(requests, dir);
   return true;
}
