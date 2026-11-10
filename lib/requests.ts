import { STATE_DIR } from './config.ts';

/** A review an agent asked the user for. Times are Unix seconds; `done` is set once the user finishes. */
export interface ReviewRequest {
   message: string;
   requested: number;
   done: number | null;
}

type Requests = Record<string, ReviewRequest>;

/** Requests are keyed by `port:pid`, so a new server on the same port starts with none. */
export const serverKey = (port: number, pid: number) => `${port}:${pid}`;

const now = () => Math.floor(Date.now() / 1000);

export function readRequests(dir = STATE_DIR): Promise<Requests> {
   return Deno.readTextFile(`${dir}/requests.json`).then((text) => JSON.parse(text), () => ({}));
}

async function write(requests: Requests, dir: string): Promise<void> {
   await Deno.mkdir(dir, { recursive: true });
   await Deno.writeTextFile(`${dir}/requests.json`, JSON.stringify(requests));
}

/** Asks for a review of a server, replacing an earlier request for it. Requests of servers no longer running go. */
export async function requestReview(key: string, message: string, running: Set<string>, dir = STATE_DIR) {
   const kept = Object.entries(await readRequests(dir)).filter(([k]) => running.has(k));
   await write({ ...Object.fromEntries(kept), [key]: { message, requested: now(), done: null } }, dir);
}

/** Marks a server's request as reviewed. False when there is no request for it. */
export async function markDone(key: string, dir = STATE_DIR): Promise<boolean> {
   const requests = await readRequests(dir);
   if (!requests[key]) return false;
   requests[key].done = now();
   await write(requests, dir);
   return true;
}
