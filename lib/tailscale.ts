import $ from '@david/dax';

const hasTailscale = () => $.commandExists('tailscale');

async function dnsName(): Promise<string | undefined> {
   if (!await hasTailscale()) return undefined;
   const status = await $`tailscale status --self --json`.stderr('null').noThrow().text();
   try {
      return JSON.parse(status).Self.DNSName.replace(/\.$/, '') || undefined;
   } catch {
      return undefined;
   }
}

export async function urlOf(port: number): Promise<string> {
   const dns = await dnsName();
   return dns ? `https://${dns}:${port}` : `http://127.0.0.1:${port}`;
}

async function published(port: number): Promise<boolean> {
   const status = await $`tailscale serve status --json`.stderr('null').noThrow().text();
   try {
      return String(port) in (JSON.parse(status).TCP ?? {});
   } catch {
      return false;
   }
}

export async function publish(port: number): Promise<void> {
   if (!await hasTailscale() || await published(port)) return;
   await $`tailscale serve --bg --https=${port} http://127.0.0.1:${port}`.quiet();
}

export async function unpublish(port: number): Promise<void> {
   if (!await hasTailscale() || !await published(port)) return;
   await $`tailscale serve --https=${port} off`.quiet();
}
