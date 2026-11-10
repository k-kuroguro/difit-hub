const list = document.getElementById('list');
const review = document.getElementById('review');
const here = document.getElementById('here');
const notify = document.getElementById('notify');
const done = document.getElementById('done');
let servers = [];

const frames = new Map();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const icon = (id) => `<svg class="octicon" aria-hidden="true"><use href="#${id}"/></svg>`;
const repoName = (s) => (s.repo ? s.repo.split('/').pop() : 'unknown repo');

const needsReview = (s) => s.request && !s.request.done;

function ago(seconds) {
   const minutes = Math.floor((Date.now() / 1000 - seconds) / 60);
   if (minutes < 1) return 'just now';
   if (minutes < 60) return `${minutes} min ago`;
   if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h ago`;
   return `${Math.floor(minutes / 60 / 24)} d ago`;
}

// Reviews waiting for the user come first, the latest request on top; the rest keep their port order.
const byUrgency = (a, b) =>
   (needsReview(b) - needsReview(a)) ||
   (needsReview(a) && b.request.requested - a.request.requested) ||
   a.port - b.port;

function item(s) {
   const count = s.comments ?? '?';
   const asked = needsReview(s);
   const path = (s.repo || '').replace(/^\/home\/[^/]+/, '~');
   return `<li class="row${asked ? ' asked' : ''}"><a class="item" href="#${s.port}">
    ${icon('git-compare')}
    <span class="name">${esc(repoName(s))}<span class="target">${esc(s.label)}</span></span>
    <span class="count${s.comments > 0 ? ' open' : ''}" aria-label="${esc(count)} unresolved comments">
      ${icon('comment')}${esc(count)}
    </span>
    ${asked ? `<span class="status">Review needed · ${ago(s.request.requested)}</span>` : ''}
    ${asked && s.request.message ? `<span class="ask">${esc(s.request.message)}</span>` : ''}
    <span class="meta"><span class="path" title="${esc(path)}">${esc(path)}</span>&nbsp;· port ${s.port}</span>
  </a><button class="stop" type="button" data-port="${s.port}" aria-label="Stop ${esc(repoName(s))} ${esc(s.label)}">
    ${icon('x')}
  </button></li>`;
}

// Stopping drops the review's unresolved comments, so a review with any asks first.
list.addEventListener('click', async (event) => {
   const button = event.target.closest('.stop');
   if (!button) return;
   const s = servers.find((s) => String(s.port) === button.dataset.port);
   if (!s) return;
   if (
      s.comments > 0 &&
      !confirm(`Stop ${repoName(s)} · ${s.label}? Its ${s.comments} unresolved comments will be lost.`)
   ) {
      return;
   }
   button.disabled = true;
   button.classList.add('busy');
   button.closest('.row').classList.add('pending');
   const res = await fetch(`/api/servers/${s.port}/stop`, { method: 'POST' });
   if (!res.ok && res.status !== 404) alert(`Couldn’t stop the review: ${await res.text()}`);
   await refresh();
});

done.addEventListener('click', async () => {
   done.disabled = true;
   done.classList.add('busy');
   const res = await fetch(`/api/servers/${done.dataset.port}/done`, { method: 'POST' });
   if (res.ok) {
      await refresh();
      location.hash = '';
      await route(); // hashchange fires later, after the spinner would already be gone
   } else {
      alert(`Couldn’t mark the review done: ${await res.text()}`);
   }
   // Only now: the spinner stays until the list is back, so the check never flashes in between.
   done.disabled = false;
   done.classList.remove('busy');
});

async function refresh() {
   try {
      const res = await fetch('/api/servers', { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      servers = (await res.json()).sort(byUrgency);
      const waiting = servers.filter(needsReview).length;
      if (waiting) navigator.setAppBadge?.(waiting);
      else navigator.clearAppBadge?.();
      list.innerHTML = servers.length
         ? servers.map(item).join('')
         : `<li class="note">No reviews running. Start one with <code>difit .</code> in a repository.</li>`;
   } catch (e) {
      // fetch rejects with a TypeError only when the request never reached the server.
      const why = e instanceof TypeError
         ? 'Can’t reach the PC running difit-hub. Check that it is on and on your tailnet.'
         : `Couldn’t load the reviews: ${esc(e.message)}`;
      list.innerHTML = `<li class="note">${why}</li>`;
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

// Notifications are tagged with the review's URL hash (see sw.js), so opening a review can clear its own.
async function clearNotifications(port) {
   const registration = await navigator.serviceWorker?.getRegistration();
   for (const n of await registration?.getNotifications({ tag: `/#${port}` }) ?? []) n.close();
}

const calm = matchMedia('(prefers-reduced-motion: reduce)');
// The port on screen, or null for the list, as soon as a change starts, so a second route() for it (the hashchange
// after a programmatic hash change) waits for that change instead of starting another.
let showing;
let moving = Promise.resolve();

function route() {
   dropStoppedFrames();
   const s = servers.find((s) => `#${s.port}` === location.hash);
   const next = s ? s.port : null;
   // Opening or leaving a review slides like an iOS navigation push; the first paint and refreshes do not animate.
   const switching = showing !== undefined && (next === null) !== (showing === null);
   showing = next;
   if (switching && document.startViewTransition && !calm.matches) {
      document.documentElement.dataset.direction = s ? 'forward' : 'back';
      // difit's frame stays out of the slide: laying it out mid-animation drops frames on the way in.
      const transition = document.startViewTransition(() => show(s, false));
      transition.ready.catch(() => {});
      moving = transition.finished.then(() => s && show(s));
      return moving;
   }
   return moving.then(() => show(s));
}

function show(s, withFrame = true) {
   review.hidden = !s;
   const shown = s && withFrame && frameFor(s);
   for (const frame of frames.values()) frame.hidden = frame !== shown;
   if (s) {
      here.textContent = `${repoName(s)} · ${s.label}`;
      clearNotifications(s.port);
   }
   done.hidden = !(s && needsReview(s));
   done.dataset.port = s ? s.port : '';
}

// The bell asks for permission and subscribes this device; iOS offers Web Push only in the home-screen app.
async function setUpNotifications() {
   if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
   const registration = await navigator.serviceWorker.register('/sw.js').catch(() => undefined);
   if (!registration) return;
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
// iOS keeps the app suspended in the background, so its list is stale until the next tick without this.
document.addEventListener('visibilitychange', () => document.hidden || refresh().then(route));
