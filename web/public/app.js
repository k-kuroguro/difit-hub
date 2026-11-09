const list = document.getElementById('list');
const review = document.getElementById('review');
const here = document.getElementById('here');
let servers = [];

const frames = new Map();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const icon = (id) => `<svg class="octicon" aria-hidden="true"><use href="#${id}"/></svg>`;
const repoName = (s) => (s.repo ? s.repo.split('/').pop() : 'unknown repo');

const keywords = { '.': 'uncommitted', working: 'unstaged', staged: 'staged' };
const targetLabel = (t) => keywords[t] ?? (t || 'HEAD');

function item(s) {
   const count = s.comments ?? '?';
   return `<li><a class="item" href="#${s.port}">
    ${icon('git-compare')}
    <span class="name">${esc(repoName(s))}<span class="target">${esc(targetLabel(s.target))}</span></span>
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
   if (s) here.textContent = `${repoName(s)} · ${targetLabel(s.target)}`;
}

refresh().then(route);
addEventListener('hashchange', route);
setInterval(() => document.hidden || !review.hidden || refresh(), 5000);
