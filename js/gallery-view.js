// "My Galaxy": the saved-cams gallery as a flyable starfield.
// Concept: James & Grok. First build: Claude (while Grok was resting). Contract: docs/gallery-integration.md
import { Galaxy } from './gallery/galaxy.js';

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function mountGallery(root, api) {
  root.innerHTML = `
    <div class="g-space"></div>
    <div class="g-hud">
      <div class="g-title">
        <div class="g-mark"><i></i></div>
        <div><b>My Galaxy</b><small class="g-count"></small></div>
      </div>
      <div class="g-search"><input type="search" placeholder="Find a star…" autocomplete="off" spellcheck="false" aria-label="Find a saved cam"><span class="g-matches"></span></div>
      <div class="g-tools">
        <button data-act="home" title="See the whole galaxy">⌂ Overview</button>
        <button data-act="wall" title="Watch the nearest 9 at once">▦ Watch wall</button>
        <button data-act="export" title="Download your galaxy">Export</button>
        <label class="g-btn" title="Merge a galaxy file">Import<input type="file" accept="application/json,.json" hidden></label>
      </div>
    </div>
    <div class="g-tip"></div>
    <div class="g-focus" hidden>
      <span class="g-fdot"></span>
      <div class="g-ftext"><b></b><small></small></div>
      <button data-act="watch" class="g-primary">▶ Watch</button>
      <button data-act="remove">Remove</button>
      <button data-act="unfocus" title="Close">✕</button>
    </div>
    <div class="g-empty" hidden>
      <div class="g-seed"></div>
      <p>Your galaxy is waiting for its first star.</p>
      <small>Open any light on the globe and press <b>★ Save</b>. Every window you keep becomes a star here.</small>
    </div>
    <div class="g-hint">drag to turn · scroll to fly in · click a star to visit it · click a card to watch · <span class="g-keys">W A S D to drift, Shift to hurry</span></div>`;

  const $ = s => root.querySelector(s);
  let galaxy = null, active = false, opened = false, focused = null, armTimer;

  function focus(cam) {
    focused = cam;
    const bar = $('.g-focus');
    if (!cam) { bar.hidden = true; return; }
    const ls = api.lightState(cam.lat, cam.lon);
    bar.querySelector('b').textContent = cam.name;
    bar.querySelector('small').textContent = `${ls.icon} ${cam.approx ? '≈ ' : ''}${cam.place}${cam.country && cam.country !== cam.place ? ' · ' + cam.country : ''}${cam.tz ? ' · ' + api.localTime(cam.tz) : ''}${cam.channel ? ' · by ' + cam.channel : ''}`;
    bar.style.setProperty('--c', (api.categories[cam.category] || api.categories.discovered).color);
    const rm = bar.querySelector('[data-act="remove"]'); rm.textContent = 'Remove'; delete rm.dataset.armed;
    bar.hidden = false;
  }
  let known = new Set(api.gallery.list().map(c => c.id));

  function ensureGalaxy() {
    if (galaxy) return galaxy;
    galaxy = new Galaxy($('.g-space'), api, {
      onHover: (cam, p) => {
        const tip = $('.g-tip');
        if (!cam) { tip.classList.remove('show'); return; }
        const ls = api.lightState(cam.lat, cam.lon);
        tip.innerHTML = '';
        const b = document.createElement('b'); b.textContent = cam.name;
        const s = document.createElement('small'); s.textContent = `${ls.icon} ${cam.place}${cam.tz ? ' · ' + api.localTime(cam.tz) : ''}`;
        tip.append(b, s);
        tip.style.transform = `translate(${Math.min(p.x + 16, innerWidth - 240)}px, ${p.y - 14}px)`;
        tip.classList.add('show');
      },
      onFocus: cam => focus(cam),
      onCount: n => {
        $('.g-count').textContent = n === 1 ? '1 star' : `${n.toLocaleString()} stars`;
        $('.g-empty').hidden = n > 0;
        root.classList.toggle('is-empty', n === 0);
      },
    });
    return galaxy;
  }

  function refresh(fresh) {
    if (!galaxy) return;
    galaxy.setItems(api.gallery.list(), fresh);
    runSearch();
  }

  api.gallery.onChange(items => {
    const ids = new Set(items.map(c => c.id));
    const fresh = new Set([...ids].filter(id => !known.has(id)));
    known = ids;
    if (!galaxy) return;
    refresh(fresh);
    if (focused && !ids.has(focused.id)) focus(null);
    if (active && fresh.size) setTimeout(() => galaxy.flyToId([...fresh].pop()), 250); // watch the new star be born
  });

  // ---- search within the galaxy ----
  function matches(q) {
    const nq = norm(q.trim()); if (!nq) return [];
    return api.gallery.list().filter(c => [c.name, c.place, c.country, c.category, c.channel].some(v => norm(v).includes(nq)));
  }
  function runSearch() {
    if (!galaxy) return;
    const q = $('.g-search input').value;
    const m = matches(q);
    galaxy.setHighlight(m.map(c => c.id));
    $('.g-matches').textContent = q.trim() ? (m.length ? `${m.length} ↵` : 'none') : '';
  }
  const input = $('.g-search input');
  input.addEventListener('input', runSearch);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const m = matches(input.value);
      if (m.length) { const i = (+input.dataset.cycle || 0) % m.length; input.dataset.cycle = i + 1; galaxy.flyToId(m[i].id); focus(m[i]); }
    } else { input.dataset.cycle = 0; }
    if (e.key === 'Escape') { input.value = ''; runSearch(); input.blur(); e.stopPropagation(); }
  });

  // ---- tools ----
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'home') { galaxy?.overview(); focus(null); }
    if (act === 'unfocus') focus(null);
    if (act === 'watch' && focused) api.openCam(focused);
    if (act === 'remove' && focused) {
      if (b.dataset.armed) { api.gallery.remove(focused.id); api.toast('Star removed'); return; }
      b.dataset.armed = '1'; b.textContent = 'Remove — sure?';
      clearTimeout(armTimer); armTimer = setTimeout(() => { delete b.dataset.armed; b.textContent = 'Remove'; }, 3500);
    }
    if (act === 'wall') {
      const ids = galaxy?.nearestIds(9) || api.gallery.list().slice(0, 9).map(c => c.id);
      if (ids.length) api.openWall(ids); else api.toast('Save a few windows first (★)');
    }
    if (act === 'export') {
      if (!api.gallery.list().length) return api.toast('Nothing to export yet');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([api.gallery.exportJSON()], { type: 'application/json' }));
      a.download = 'now-here-galaxy.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
  });
  root.addEventListener('change', async e => {
    if (!e.target.matches('input[type=file]')) return;
    const f = e.target.files?.[0]; if (!f) return;
    try { const n = api.gallery.importJSON(await f.text()); api.toast(n ? `${n} new star${n === 1 ? '' : 's'} added` : 'Those stars are already in your galaxy'); if (n > 3) setTimeout(() => galaxy?.overview(), 400); }
    catch { api.toast('That file isn’t a Now Here galaxy'); }
    e.target.value = '';
  });

  return {
    setActive(on) {
      active = on;
      if (on) {
        ensureGalaxy();
        refresh();
        if (!opened) { opened = true; galaxy.camera.position.set(0, 900, 1400); galaxy.overview(2600); }
        galaxy.start();
      } else if (galaxy) {
        galaxy.stop();
        $('.g-tip').classList.remove('show');
      }
    },
    refresh: () => refresh(),
    destroy() { galaxy?.dispose(); galaxy = null; root.innerHTML = ''; },
  };
}
