const list = document.getElementById('list');
const review = document.getElementById('review');
const here = document.getElementById('here');
const notify = document.getElementById('notify');
let servers = [];

const frames = new Map();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const icon = (id) => `<svg class="octicon" aria-hidden="true"><use href="#${id}"/></svg>`;
const repoName = (s) => (s.repo ? s.repo.split('/').pop() : 'unknown repo');

function item(s) {
   const count = s.comments ?? '?';
   return `<li><a class="item" href="#${s.port}">
    ${icon('git-compare')}
    <span class="name">${esc(repoName(s))}<span class="target">${esc(s.label)}</span></span>
    <span class="count${s.comments > 0 ? ' open' : ''}" aria-label="${esc(count)} unresolved comments">
      ${icon('comment')}${esc(count)}
    </span>
    <span class="meta">${esc((s.repo || '').replace(/^\/home\/[^/]+/, '~'))} · port ${s.port}</span>
  </a></li>`;
}

async function refresh() {
   try {
      const res = await fetch('/api/servers', { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      servers = await res.json();
      list.innerHTML = servers.length
         ? servers.map(item).join('')
         : `<li class="note">No reviews running. Start one with <code>difit .</code> in a repository.</li>`;
   } catch (e) {
      list.innerHTML = `<li class="note">Couldn’t load the reviews: ${esc(e.message)}</li>`;
   }
}

const frameKey = (s) => `${s.port}:${s.pid}`;

function frameFor(s) {
   let frame = frames.get(frameKey(s));
   if (!frame) {
      frame = document.createElement('iframe');
      frame.title = 'Review';
      frame.allow = 'clipboard-read; clipboard-write';
      frame.className = 'loading';
      frame.addEventListener('load', () => frame.classList.remove('loading'), { once: true });
      frame.src = s.url;
      review.append(frame);
      frames.set(frameKey(s), frame);
   }
   return frame;
}

function dropStoppedFrames() {
   const running = new Set(servers.map(frameKey));
   for (const [key, frame] of frames) {
      if (!running.has(key)) {
         frame.remove();
         frames.delete(key);
      }
   }
}

function route() {
   dropStoppedFrames();
   const s = servers.find((s) => `#${s.port}` === location.hash);
   review.hidden = !s;
   const shown = s && frameFor(s);
   for (const frame of frames.values()) frame.hidden = frame !== shown;
   if (s) here.textContent = `${repoName(s)} · ${s.label}`;
}

// The bell asks for permission and subscribes this device; iOS offers Web Push only in the home-screen app.
async function setUpNotifications() {
   if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
   const registration = await navigator.serviceWorker.register('/sw.js');
   const save = (subscription) =>
      fetch('/api/push/subscriptions', {
         method: 'POST',
         headers: { 'content-type': 'application/json' },
         body: JSON.stringify(subscription),
      });

   const existing = await registration.pushManager.getSubscription();
   if (existing && Notification.permission === 'granted') {
      await save(existing);
      return;
   }

   notify.hidden = false;
   notify.addEventListener('click', async () => {
      if (await Notification.requestPermission() !== 'granted') return;
      const { key } = await (await fetch('/api/push/key')).json();
      const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
      const subscription = await registration.pushManager.subscribe({
         userVisibleOnly: true,
         applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)),
      });
      await save(subscription);
      notify.hidden = true;
   });
}

// A tapped notification for a review that started after the last refresh.
navigator.serviceWorker?.addEventListener('message', async (event) => {
   if (!event.data?.open) return;
   await refresh();
   location.hash = new URL(event.data.open).hash;
   route();
});

refresh().then(route);
setUpNotifications();
addEventListener('hashchange', route);
setInterval(() => document.hidden || !review.hidden || refresh(), 5000);
