import webpush from 'web-push';

import { STATE_DIR } from '@/lib/config.ts';

export interface Subscription {
   endpoint: string;
   keys: { p256dh: string; auth: string };
}

export interface Message {
   title: string;
   body: string;
   url: string;
   badge: number;
}

interface Keys {
   publicKey: string;
   privateKey: string;
}

type Send = (subscription: Subscription, payload: string, options: object) => Promise<unknown>;

// Push services require a sender contact; the project page gives one without naming a person.
const SUBJECT = 'https://github.com/k-kuroguro/difit-hub';

const readJson = <T>(path: string, fallback: T): Promise<T> =>
   Deno.readTextFile(path).then((text) => JSON.parse(text), () => fallback);

const isSubscription = (value: unknown): value is Subscription => {
   const s = value as Subscription;
   return typeof s?.endpoint === 'string' && s.endpoint.startsWith('https://') &&
      typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string';
};

export class Push {
   #dir: string;
   #send: Send;

   constructor(dir = STATE_DIR, send: Send = webpush.sendNotification) {
      this.#dir = dir;
      this.#send = send;
   }

   async #keys(): Promise<Keys> {
      const path = `${this.#dir}/vapid.json`;
      const saved = await readJson<Keys | null>(path, null);
      if (saved) return saved;
      const keys = webpush.generateVAPIDKeys();
      await Deno.mkdir(this.#dir, { recursive: true });
      await Deno.writeTextFile(path, JSON.stringify(keys), { mode: 0o600 });
      return keys;
   }

   #subscriptions(): Promise<Subscription[]> {
      return readJson(`${this.#dir}/subscriptions.json`, []);
   }

   async #save(subscriptions: Subscription[]): Promise<void> {
      await Deno.mkdir(this.#dir, { recursive: true });
      await Deno.writeTextFile(`${this.#dir}/subscriptions.json`, JSON.stringify(subscriptions), { mode: 0o600 });
   }

   async publicKey(): Promise<string> {
      return (await this.#keys()).publicKey;
   }

   async subscribe(subscription: unknown): Promise<boolean> {
      if (!isSubscription(subscription)) return false;
      const { endpoint, keys } = subscription;
      const others = (await this.#subscriptions()).filter((s) => s.endpoint !== endpoint);
      await this.#save([...others, { endpoint, keys }]);
      return true;
   }

   async notify(message: Message): Promise<void> {
      const subscriptions = await this.#subscriptions();
      if (subscriptions.length === 0) return;
      const vapidDetails = { subject: SUBJECT, ...await this.#keys() };
      const gone = new Set<string>();
      await Promise.all(subscriptions.map(async (s) => {
         try {
            await this.#send(s, JSON.stringify(message), { vapidDetails, TTL: 3600 });
         } catch (e) {
            const status = (e as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) gone.add(s.endpoint);
            else console.error(`push to ${new URL(s.endpoint).host} failed: ${e}`);
         }
      }));
      if (gone.size) await this.#save(subscriptions.filter((s) => !gone.has(s.endpoint)));
   }
}
