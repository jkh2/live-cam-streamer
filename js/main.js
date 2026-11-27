import { Globe } from './globe.js';
import { CONFIG, CATEGORIES } from './config.js';
import { lightState, distanceKm, subsolarPoint } from './sun.js';
import { gallery } from './store.js';
import { thumbUrl, embedUrl, watchUrl, getKey, setKey, verifyLive, searchLive, loadPlayerAPI } from './youtube.js';
import { mountGallery } from './gallery-view.js';
import { sound } from './sound.js';
import { communityEnabled, loadCommunityCams, submitCam, videoIdFrom, guessTz } from './community.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

const state = {
  catalog: [], discovered: [], cams: [],
  hidden: new Set(), offline: new Set(),
  current: null, hover: -1,
  tour: null, geoCache: new Map(),
  verified: false,
};

// ---------- time helpers ----------
const fmtCache = new Map();
function localTime(tz) {
  if (!tz) return '';
  try {
    if (!fmtCache.has(tz)) fmtCache.set(tz, new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', timeZone: tz }));
    return fmtCache.get(tz).format(new Date());
  } catch { return ''; }
}

// ---------- toast ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ---------- cams on the globe ----------
function rebuildCams() {
  const sub = subsolarPoint();
  state.cams = [...state.catalog, ...state.discovered].map(c => {
    const cat = CATEGORIES[c.category] || CATEGORIES.discovered;
    c.color = hexToRgb(cat.color);
    c.visible = !state.hidden.has(c.category) && !state.offline.has(c.id);
    c.golden = lightState(c.lat, c.lon, sub).key === 'golden';
    return c;
  });
  globe.setCams(state.cams);
  if (state.current) globe.setSelected(indexOf(state.current.id));
  updateStats();
}

function refreshFlags() {
  const sub = subsolarPoint();
  for (const c of state.cams) {
    c.visible = !state.hidden.has(c.category) && !state.offline.has(c.id);
    c.golden = lightState(c.lat, c.lon, sub).key === 'golden';
  }
  globe.refreshFlags();
  updateStats();
}

const indexOf = id => state.cams.findIndex(c => c.id === id);
const visibleCams = () => state.cams.filter(c => c.visible);

function updateStats() {
  const sub = subsolarPoint();
  const vis = state.cams.filter(c => !state.offline.has(c.id));
  let day = 0, golden = 0, night = 0;
  for (const c of vis) { const k = lightState(c.lat, c.lon, sub).key; if (k === 'day') day++; else if (k === 'golden') golden++; else night++; }
  $('#stats').innerHTML = `<b>${vis.length}</b> live windows <span class="sep">·</span> <span title="In daylight">☀ ${day}</span> <span class="sep">·</span> <span class="gold" title="At golden hour right now">🌅 ${golden}</span> <span class="sep">·</span> <span title="At night or twilight">🌙 ${night}</span>${state.verified ? ' <span class="ok" title="Checked against YouTube just now">✓ verified</span>' : ''}`;
}

// ---------- hover card ----------
function showHover(i, pointer) {
  state.hover = i;
  const card = $('#hovercard');
  if (i < 0) { card.classList.remove('show'); return; }
  const c = state.cams[i];
  const ls = lightState(c.lat, c.lon);
  card.innerHTML = `<div class="hc-name">${esc(c.name)}</div>
    <div class="hc-sub">${c.approx ? '≈ ' : ''}${esc(c.place)}${c.country && c.country !== c.place ? ' · ' + esc(c.country) : ''}</div>
    <div class="hc-row"><span>${ls.icon} ${esc(ls.label)}</span>${c.tz ? `<span>${localTime(c.tz)}</span>` : ''}</div>`;
  card.style.setProperty('--c', (CATEGORIES[c.category] || CATEGORIES.discovered).color);
  card.classList.add('show');
  positionHover(pointer.x, pointer.y);
  sound.tick();
}
function positionHover(x, y) {
  const card = $('#hovercard');
  const w = card.offsetWidth, h = card.offsetHeight;
  let left = x + 18, top = y - h / 2;
  if (left + w > innerWidth - 12) left = x - w - 18;
  top = Math.max(70, Math.min(innerHeight - h - 90, top));
  card.style.transform = `translate(${left}px, ${top}px)`;
}

// ---------- the window (video panel) ----------
let player = null, playerCheck = null;
const isMobile = () => innerWidth < 760;

function panelShift() {
  const p = $('#window');
  if (!p.classList.contains('open')) return globe.setViewShift(0, 0);
  if (isMobile()) globe.setViewShift(0, p.offsetHeight / 2 - 10);
  else globe.setViewShift((p.offsetWidth + 28) / 2, 0);
}

async function openCam(camOrId, { fromTour = false, fly = true } = {}) {
  let cam = typeof camOrId === 'string' ? state.cams.find(c => c.id === camOrId) : camOrId;
  if (!cam) return;
  if (indexOf(cam.id) < 0) { // a saved/discovered cam not on the globe yet
    state.discovered.push({ ...cam, category: cam.category || 'discovered' });
    rebuildCams();
    cam = state.cams[indexOf(cam.id)];
  }
  if (!fromTour) stopTour();
  state.current = cam;
  const i = indexOf(cam.id);
  globe.setSelected(i);
  if (fly) globe.flyTo(cam.lat, cam.lon, isMobile() ? 2.0 : 1.72);
  sound.whoosh();

  const p = $('#window');
  const cat = CATEGORIES[cam.category] || CATEGORIES.discovered;
  p.style.setProperty('--c', cat.color);
  $('#w-cat').innerHTML = esc(cat.label) + (cam.community ? ' · <span class="community">COMMUNITY</span>' : '');
  $('#w-name').textContent = cam.name;
  $('#w-place').textContent = `${cam.approx ? '≈ ' : ''}${cam.place}${cam.country && cam.country !== cam.place ? ' · ' + cam.country : ''}`;
  $('#w-by').innerHTML = `Streamed by <a href="${esc(cam.channelUrl)}" target="_blank" rel="noopener">${esc(cam.channel)}</a>`;
  $('#w-yt').href = watchUrl(cam.id);
  $('#w-report').href = `https://github.com/${CONFIG.repo}/issues/new?` + new URLSearchParams({
    title: `Camera report: ${cam.name} (${cam.id})`,
    body: `Camera: ${cam.name}\nYouTube id: ${cam.id}\nChannel: ${cam.channel}\n\nWhat's wrong? (private/unauthorized, not live, wrong location, other):\n`,
  });
  $('#w-notice').hidden = true;
  updateSaveButton();
  updateWindowMeta();
  renderNearby();
  p.classList.add('open');
  p.setAttribute('aria-hidden', 'false');
  document.body.classList.add('win-open');
  requestAnimationFrame(panelShift);
  history.replaceState(null, '', '#cam=' + cam.id);
  loadPlayer(cam);
}

function updateWindowMeta() {
  const cam = state.current; if (!cam) return;
  const ls = lightState(cam.lat, cam.lon);
  $('#w-meta').innerHTML = `
    <span class="pill ${ls.key}">${ls.icon} ${esc(ls.label)}</span>
    <span class="pill">sun ${ls.elevation >= 0 ? '+' : ''}${ls.elevation.toFixed(1)}°</span>
    ${cam.tz ? `<span class="pill">🕓 ${localTime(cam.tz)} local</span>` : ''}
    <span class="pill mono">${cam.lat.toFixed(2)}°, ${cam.lon.toFixed(2)}°</span>`;
}

async function loadPlayer(cam) {
  const box = $('#w-video');
  clearInterval(playerCheck);
  if (player?.destroy) { try { player.destroy(); } catch {} }
  player = null;
  box.innerHTML = '<div id="w-player"></div><div class="w-loading"><span></span>opening window…</div>';
  const YT = await loadPlayerAPI();
  if (state.current?.id !== cam.id) return; // user moved on
  if (!YT) { box.innerHTML = `<iframe src="${embedUrl(cam.id)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="${esc(cam.name)}"></iframe>`; return; }
  player = new YT.Player('w-player', {
    host: 'https://www.youtube-nocookie.com',
    videoId: cam.id,
    playerVars: { autoplay: 1, mute: 1, playsinline: 1, rel: 0, modestbranding: 1 },
    events: {
      onReady: e => { e.target.mute(); e.target.playVideo(); box.querySelector('.w-loading')?.remove(); },
      onStateChange: e => {
        if (e.data === 1) { // playing
          box.querySelector('.w-loading')?.remove();
          const vd = e.target.getVideoData?.();
          if (vd && vd.isLive === false) notLive(cam, 'This stream is no longer live, so it’s been hidden.');
        }
      },
      onError: e => {
        // 100 = video removed → hide it. Other codes (101/150 = embed refused, 2/5 = player issue) can be
        // transient or caused by YouTube's bot checks, so never hide on them; the verifier handles real outages.
        if (e.data === 100) notLive(cam, 'This stream has ended or been removed, so it’s been hidden.');
        else softNotice(cam, 'YouTube wouldn’t start this stream here.');
      },
    },
  });
}

function notLive(cam, msg) {
  state.offline.add(cam.id);
  refreshFlags();
  const n = $('#w-notice');
  n.innerHTML = `${esc(msg)} <button class="link" data-next>Show me a nearby window →</button>`;
  n.hidden = false;
  try { player?.stopVideo?.(); } catch {}
}

function softNotice(cam, msg) {
  const n = $('#w-notice');
  n.innerHTML = `${esc(msg)} <a href="${watchUrl(cam.id)}" target="_blank" rel="noopener">Open it on YouTube ↗</a> or <button class="link" data-next>try a nearby window →</button>`;
  n.hidden = false;
}

function closeWindow() {
  const p = $('#window');
  if (!p.classList.contains('open')) return;
  p.classList.remove('open');
  p.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('win-open');
  clearInterval(playerCheck);
  if (player?.destroy) { try { player.destroy(); } catch {} }
  player = null;
  $('#w-video').innerHTML = '';
  state.current = null;
  globe.setSelected(-1);
  globe.setViewShift(0, 0);
  history.replaceState(null, '', location.pathname + location.search);
  stopTour();
  scheduleAutoRotate();
}

function nearestTo(cam, n = 6) {
  return visibleCams().filter(c => c.id !== cam.id)
    .map(c => ({ c, d: distanceKm(cam.lat, cam.lon, c.lat, c.lon) }))
    .sort((a, b) => a.d - b.d).slice(0, n);
}

function renderNearby() {
  const cam = state.current;
  $('#w-nearby').innerHTML = nearestTo(cam).map(({ c, d }) =>
    `<button class="near" data-open="${esc(c.id)}" style="--c:${(CATEGORIES[c.category] || CATEGORIES.discovered).color}">
      <img src="${thumbUrl(c.id, { size: 'mq' })}" alt="" loading="lazy"><span>${esc(c.name)}</span><em>${d < 10 ? '<10' : Math.round(d).toLocaleString()} km</em></button>`).join('');
}

function updateSaveButton() {
  const b = $('#w-save');
  const saved = state.current && gallery.has(state.current.id);
  b.classList.toggle('on', !!saved);
  b.innerHTML = saved ? '★ Saved' : '☆ Save';
  const n = gallery.list().length;
  $('#gallery-count').textContent = n || '';
}

// ---------- tether from globe point to window ----------
function updateTether() {
  const svg = $('#tether');
  const p = $('#window');
  if (!state.current || !p.classList.contains('open')) { svg.classList.remove('show'); return; }
  const i = indexOf(state.current.id);
  const s = globe.screenOf(i);
  if (!s || s.facing < 0.05) { svg.classList.remove('show'); return; }
  const r = p.getBoundingClientRect();
  let ex, ey, c1x, c1y;
  if (isMobile()) { ex = Math.min(Math.max(s.x, r.left + 30), r.right - 30); ey = r.top; c1x = s.x; c1y = (s.y + ey) / 2; }
  else { ex = r.left; ey = Math.min(Math.max(s.y, r.top + 40), r.top + 120); c1x = (s.x + ex) / 2; c1y = s.y; }
  $('#tether-path').setAttribute('d', `M${s.x},${s.y} Q${c1x},${c1y} ${ex},${ey}`);
  $('#tether-dot').setAttribute('cx', ex); $('#tether-dot').setAttribute('cy', ey);
  $('#tether-src').setAttribute('cx', s.x); $('#tether-src').setAttribute('cy', s.y);
  svg.style.setProperty('--c', (CATEGORIES[state.current.category] || CATEGORIES.discovered).color);
  svg.classList.add('show');
}

// ---------- tours ----------
function startTour(mode) {
  stopTour(true);
  const btn = $(`[data-tour="${mode}"]`);
  btn.classList.add('on');
  state.tour = { mode, idx: 0, history: [] };
  tourStep();
  toast(mode === 'sun' ? 'Following the sun: windows at sunrise and sunset right now' : 'Wandering the planet…');
}

function pickTourCam() {
  const t = state.tour, sub = subsolarPoint();
  const pool = visibleCams().filter(c => !t.history.includes(c.id));
  if (!pool.length) { t.history = []; return visibleCams()[0]; }
  if (t.mode === 'sun') {
    const scored = pool.map(c => ({ c, e: lightState(c.lat, c.lon, sub).elevation }))
      .filter(x => x.e > -6 && x.e < 10).sort((a, b) => Math.abs(a.e - 1) - Math.abs(b.e - 1));
    if (scored.length) return scored[Math.floor(Math.random() * Math.min(4, scored.length))].c;
    return pool.map(c => ({ c, e: Math.abs(lightState(c.lat, c.lon, sub).elevation) })).sort((a, b) => a.e - b.e)[0].c;
  }
  // wander: prefer somewhere far from the current window
  const here = state.current;
  const far = here ? pool.filter(c => distanceKm(here.lat, here.lon, c.lat, c.lon) > 2500) : pool;
  const list = far.length ? far : pool;
  return list[Math.floor(Math.random() * list.length)];
}

function tourStep() {
  const t = state.tour; if (!t) return;
  const cam = pickTourCam();
  if (!cam) return;
  t.history.push(cam.id); if (t.history.length > 30) t.history.shift();
  openCam(cam, { fromTour: true });
  t.next = performance.now() + CONFIG.tourSeconds * 1000;
  clearTimeout(t.timer);
  t.timer = setTimeout(tourStep, CONFIG.tourSeconds * 1000);
}

function stopTour(silent) {
  if (!state.tour) return;
  clearTimeout(state.tour.timer);
  state.tour = null;
  document.querySelectorAll('[data-tour]').forEach(b => { b.classList.remove('on'); b.style.setProperty('--p', 0); });
  $('#w-tour').hidden = true;
}

function updateTourUI() {
  const t = state.tour;
  if (!t) return;
  const left = Math.max(0, (t.next - performance.now()) / 1000);
  const btn = $(`[data-tour="${t.mode}"]`);
  btn.style.setProperty('--p', 1 - left / CONFIG.tourSeconds);
  const wt = $('#w-tour');
  wt.hidden = false;
  wt.innerHTML = `${t.mode === 'sun' ? '🌅 Following the sun' : '🧭 Wandering'} · next window in ${Math.ceil(left)}s <button class="link" data-skip>skip</button> <button class="link" data-stop>stop</button>`;
}

// ---------- auto-rotate when idle ----------
let idleTimer;
function scheduleAutoRotate() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!state.current && !state.tour) globe.setAutoRotate(true); }, 9000);
}

// ---------- search ----------
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let searchSel = -1, searchItems = [];

function runSearch(q) {
  const box = $('#results');
  const nq = norm(q.trim());
  if (!nq) { box.classList.remove('show'); return; }
  const scored = [];
  for (const c of state.cams) {
    const name = norm(c.name), place = norm(c.place), country = norm(c.country), cat = norm((CATEGORIES[c.category] || {}).label + ' ' + c.category);
    let s = 0;
    if (name.startsWith(nq)) s = 100; else if (name.includes(nq)) s = 70;
    if (place.startsWith(nq)) s = Math.max(s, 80); else if (place.includes(nq)) s = Math.max(s, 55);
    if (country.startsWith(nq)) s = Math.max(s, 60); else if (country.includes(nq)) s = Math.max(s, 40);
    if (cat.includes(nq)) s = Math.max(s, 35);
    if (s) scored.push({ c, s });
  }
  scored.sort((a, b) => b.s - a.s);
  searchItems = [
    ...scored.slice(0, 8).map(({ c }) => ({ type: 'cam', c })),
    { type: 'place', q },
    { type: 'discover', q },
  ];
  searchSel = scored.length ? 0 : -1;
  renderResults();
}

function renderResults(extraHTML = '') {
  const box = $('#results');
  const hasKey = !!getKey();
  box.innerHTML = searchItems.map((it, i) => {
    const sel = i === searchSel ? ' sel' : '';
    if (it.type === 'cam') {
      const c = it.c, ls = lightState(c.lat, c.lon);
      return `<button class="r-item${sel}" data-i="${i}" style="--c:${(CATEGORIES[c.category] || CATEGORIES.discovered).color}">
        <span class="r-dot"></span><span class="r-main"><b>${esc(c.name)}</b><small>${esc(c.place)}${c.country && c.country !== c.place ? ' · ' + esc(c.country) : ''}</small></span><span class="r-side">${ls.icon}</span></button>`;
    }
    if (it.type === 'place') return `<button class="r-item r-action${sel}" data-i="${i}">📍 <span class="r-main"><b>Fly to “${esc(it.q)}”</b><small>and show the nearest windows</small></span></button>`;
    if (it.type === 'discover') return `<button class="r-item r-action${sel}" data-i="${i}">🔴 <span class="r-main"><b>Find live streams for “${esc(it.q)}”</b><small>${hasKey ? 'searches all of YouTube Live (live + embeddable only)' : 'needs a free YouTube API key, set it up in ⚙'}</small></span></button>`;
    return '';
  }).join('') + extraHTML;
  box.classList.add('show');
}

async function geocode(q) {
  const k = norm(q);
  if (state.geoCache.has(k)) return state.geoCache.get(k);
  const r = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ format: 'json', limit: 1, q }), { headers: { 'Accept-Language': 'en' } });
  const j = await r.json();
  const g = j[0] ? { lat: +j[0].lat, lon: +j[0].lon, name: j[0].display_name.split(',').slice(0, 2).join(',').trim(), country: j[0].display_name.split(',').pop().trim() } : null;
  state.geoCache.set(k, g);
  return g;
}

async function chooseResult(i) {
  const it = searchItems[i]; if (!it) return;
  if (it.type === 'cam') { closeSearch(); openCam(it.c); return; }
  if (it.type === 'place') {
    renderResults('<div class="r-note">Finding that place…</div>');
    try {
      const g = await geocode(it.q);
      if (!g) return renderResults('<div class="r-note">Couldn’t find that place.</div>');
      closeWindow();
      globe.flyTo(g.lat, g.lon, 2.3);
      const near = visibleCams().map(c => ({ c, d: distanceKm(g.lat, g.lon, c.lat, c.lon) })).sort((a, b) => a.d - b.d).slice(0, 6);
      searchItems = near.map(({ c }) => ({ type: 'cam', c }));
      searchSel = 0;
      renderResults(`<div class="r-note">Nearest windows to <b>${esc(g.name)}</b>: ${near.map(n => Math.round(n.d).toLocaleString() + ' km').slice(0, 1)} to the closest</div>`);
    } catch { renderResults('<div class="r-note">Place search is unavailable right now.</div>'); }
    return;
  }
  if (it.type === 'discover') {
    if (!getKey()) { closeSearch(); openModal('#settings'); return; }
    renderResults('<div class="r-note">Searching YouTube Live…</div>');
    try {
      const [results, g] = await Promise.all([searchLive(`${it.q} live cam`), geocode(it.q).catch(() => null)]);
      if (!results.length) return renderResults('<div class="r-note">No live, embeddable streams found for that.</div>');
      const known = new Set(state.cams.map(c => c.id));
      const html = `<div class="r-disc-head">Live on YouTube now${g ? ` · placed near <b>${esc(g.name)}</b>` : ''}</div><div class="r-disc">` +
        results.map(r => `<button class="r-disc-item" data-disc="${esc(r.id)}"><img src="${esc(r.thumb || thumbUrl(r.id, { size: 'mq' }))}" alt=""><span>${esc(r.title)}</span><small>${esc(r.channel)}${known.has(r.id) ? ' · already on the globe' : ''}</small></button>`).join('') + '</div>';
      state._disc = { results, g, q: it.q };
      searchItems = []; searchSel = -1;
      renderResults(html);
    } catch (e) { renderResults(`<div class="r-note">YouTube search failed: ${esc(e.message)}</div>`); }
  }
}

function openDiscovered(id) {
  const d = state._disc; if (!d) return;
  const r = d.results.find(x => x.id === id); if (!r) return;
  const existing = state.cams.find(c => c.id === id);
  if (existing) { closeSearch(); openCam(existing); return; }
  const g = d.g || { lat: 0, lon: 0, name: d.q, country: '' };
  // spread multiple discoveries around the place so beacons don't stack
  const jitter = () => (Math.random() - 0.5) * 0.25;
  const cam = {
    id, source: 'youtube', name: r.title.length > 64 ? r.title.slice(0, 62) + '…' : r.title,
    place: g.name, country: g.country, lat: g.lat + jitter(), lon: g.lon + jitter(),
    category: 'discovered', channel: r.channel, channelUrl: r.channelUrl, title: r.title, approx: true,
  };
  closeSearch();
  openCam(cam);
}

function closeSearch() { $('#results').classList.remove('show'); $('#search').blur(); }

// ---------- modals, drawer, wall ----------
function openModal(sel) { closeModals(); $(sel).classList.add('open'); if (sel === '#settings') fillSettings(); }
function closeModals() { document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open')); }

let galleryView;
function toggleDrawer(force) {
  const d = $('#gallery-layer');
  const open = force ?? !d.classList.contains('open');
  if (open === d.classList.contains('open')) return;
  d.classList.toggle('open', open);
  document.body.classList.toggle('in-gallery', open);
  globe.paused = open;              // the gallery gets the GPU while it's open
  if (open) { closeSearch(); hideHover(); }
  galleryView?.setActive(open);
}
function hideHover() { state.hover = -1; $('#hovercard').classList.remove('show'); }

function openWall(ids) {
  ids = ids.slice(0, CONFIG.maxWall);
  if (!ids.length) return toast('Save a few windows first (★)');
  const all = [...state.cams, ...gallery.list()];
  const cams = ids.map(id => all.find(c => c.id === id)).filter(Boolean);
  const n = cams.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const grid = $('#wall-grid');
  grid.style.setProperty('--cols', cols);
  grid.innerHTML = cams.map(c => `<figure class="wall-tile">
    <iframe src="${embedUrl(c.id, { controls: false })}" allow="autoplay; encrypted-media; picture-in-picture" title="${esc(c.name)}"></iframe>
    <figcaption><span>${esc(c.name)} <em>${esc(c.place)}${c.tz ? ' · ' + localTime(c.tz) : ''}</em></span><button data-wall-open="${esc(c.id)}">Open ↗</button></figcaption></figure>`).join('');
  $('#wall').classList.add('open');
  toggleDrawer(false);
}
function closeWall() { $('#wall').classList.remove('open'); $('#wall-grid').innerHTML = ''; }

function fillSettings() {
  $('#yt-key').value = getKey();
  $('#sound-toggle').checked = sound.enabled;
  $('#key-status').textContent = getKey() ? 'Key saved in this browser.' : 'No key set. Everything still works; discovery and live-verification are off.';
}

async function verifyCatalog(showToast = true) {
  if (!getKey()) return;
  try {
    const ids = state.catalog.map(c => c.id);
    const st = await verifyLive(ids);
    let off = 0;
    for (const [id, s] of st) { if (!s.live || !s.embeddable) { state.offline.add(id); off++; } else state.offline.delete(id); }
    state.verified = true;
    refreshFlags();
    if (showToast) toast(`Verified with YouTube: ${ids.length - off} live now${off ? `, ${off} offline hidden` : ''}`);
  } catch (e) { if (showToast) toast('Verification failed: ' + e.message); }
}

// ---------- chips ----------
function renderChips() {
  const counts = {};
  for (const c of state.catalog) counts[c.category] = (counts[c.category] || 0) + 1;
  const cats = Object.keys(CATEGORIES).filter(k => counts[k]);
  $('#chips').innerHTML = `<button class="chip ${state.hidden.size ? '' : 'on'}" data-cat="*">All</button>` +
    cats.map(k => `<button class="chip ${state.hidden.has(k) ? '' : 'on'}" data-cat="${k}" style="--c:${CATEGORIES[k].color}"><i></i>${CATEGORIES[k].label}<small>${counts[k]}</small></button>`).join('');
}

function toggleCat(k) {
  const cats = [...new Set(state.catalog.map(c => c.category))];
  if (k === '*') state.hidden.clear();
  else if (!state.hidden.size) { cats.forEach(c => c !== k && state.hidden.add(c)); } // first click isolates
  else if (state.hidden.has(k)) state.hidden.delete(k);
  else { state.hidden.add(k); if (state.hidden.size === cats.length) state.hidden.clear(); }
  renderChips(); refreshFlags();
}

// ---------- boot ----------
let globe;
async function boot() {
  globe = new Globe($('#stage'), {
    onHover: (i, p) => showHover(i, p),
    onSelect: i => openCam(state.cams[i]),
    onInteract: () => { clearTimeout(idleTimer); if (!state.current) scheduleAutoRotate(); },
    onFrame: () => {
      updateTether();
      if (state.hover >= 0) { const s = globe.screenOf(state.hover); if (s) positionHover(s.x, s.y); }
      updateTourUI();
    },
  });

  let data;
  try { data = await (await fetch('data/cams.json', { cache: 'no-cache' })).json(); }
  catch { $('#intro-sub').textContent = 'Couldn’t load the camera catalog. Serve this folder over http(s).'; return; }
  state.catalog = data.cams;
  for (const c of state.catalog) if (c.offline) state.offline.add(c.id);
  rebuildCams();
  renderChips();
  loadCommunityCams().then(extra => {
    const have = new Set(state.catalog.map(c => c.id));
    const fresh = extra.filter(c => !have.has(c.id));
    if (!fresh.length) return;
    state.catalog.push(...fresh);
    rebuildCams(); renderChips();
  });

  // intro: swoop in toward the sunset line, where city lights are switching on
  const sub = subsolarPoint();
  const startLon = ((sub.lon + 75 + 540) % 360) - 180;
  globe.flyTo(Math.max(-30, Math.min(35, sub.lat + 15)), startLon, isMobile() ? 3.9 : 3.15, 3800);
  setTimeout(() => { $('#intro').classList.add('gone'); globe.setAutoRotate(true); }, 2600);

  galleryView = mountGallery($('#gallery-root'), {
    gallery, openCam: c => { toggleDrawer(false); openCam(c); }, thumbUrl, embedUrl,
    lightState, localTime, openWall, toast, categories: CATEGORIES, close: () => toggleDrawer(false),
  });
  gallery.onChange(updateSaveButton);
  updateSaveButton();

  window.addEventListener('nowhere:open-cam', e => {
    const d = e.detail || {};
    if (d.cam) openCam(d.cam); else if (d.id) openCam(state.cams.find(c => c.id === d.id) || gallery.list().find(c => c.id === d.id));
  });

  // deep link
  const m = location.hash.match(/cam=([\w-]{11})/);
  if (m) setTimeout(() => openCam(state.cams.find(c => c.id === m[1]) || gallery.list().find(c => c.id === m[1])), 3000);

  verifyCatalog(false);
  setInterval(() => { refreshFlags(); updateWindowMeta(); }, 60000);
  setInterval(() => { $('#clock').textContent = new Date().toISOString().slice(11, 16) + ' UTC'; }, 1000);
  $('#clock').textContent = new Date().toISOString().slice(11, 16) + ' UTC';
  wireUI();
}

// ---------- add your camera ----------
let sfPlace = null;
function wireSubmit() {
  if (!communityEnabled()) return;
  $('#btn-add').hidden = false;
  $('#btn-add').addEventListener('click', () => { openModal('#submit'); $('#sf-status').textContent = ''; });
  const f = $('#submit-form');

  f.url.addEventListener('change', () => {
    const id = videoIdFrom(f.url.value);
    const pv = $('#sf-preview');
    if (!id) { pv.hidden = false; pv.className = 'sf-preview warn'; pv.textContent = 'That doesn’t look like a YouTube link yet.'; return; }
    const known = state.cams.find(c => c.id === id);
    pv.hidden = false; pv.className = 'sf-preview' + (known ? ' warn' : '');
    pv.innerHTML = `<img src="${thumbUrl(id, { size: 'mq' })}" alt=""><div>${known ? `This camera is already on the globe: <b>${esc(known.name)}</b>. <button type="button" class="link" data-fly="${esc(id)}">Show me</button>` : 'Found it. If this is a live stream, the picture is its latest frame.'}</div>`;
  });
  $('#sf-preview').addEventListener('click', e => { const b = e.target.closest('[data-fly]'); if (b) { closeModals(); openCam(b.dataset.fly); } });

  async function findPlace() {
    const q = f.placeq.value.trim(); if (q.length < 2) return;
    const box = $('#sf-places'); box.innerHTML = '<div class="dim small">Searching…</div>';
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ format: 'json', limit: 5, q }), { headers: { 'Accept-Language': 'en' } });
      const list = await r.json();
      if (!list.length) { box.innerHTML = '<div class="dim small">No match. Try a nearby town or landmark.</div>'; return; }
      box.innerHTML = list.map((p, i) => `<button type="button" class="sf-place" data-i="${i}">${esc(p.display_name)}<small>${(+p.lat).toFixed(4)}°, ${(+p.lon).toFixed(4)}°</small></button>`).join('');
      box.onclick = e => {
        const b = e.target.closest('[data-i]'); if (!b) return;
        const p = list[+b.dataset.i], parts = p.display_name.split(',').map(x => x.trim());
        sfPlace = { lat: +p.lat, lon: +p.lon, place: parts.slice(0, 2).join(', '), country: parts[parts.length - 1] };
        box.querySelectorAll('.sf-place').forEach(x => x.classList.toggle('on', x === b));
      };
      if (list.length === 1) box.querySelector('.sf-place').click();
    } catch { box.innerHTML = '<div class="dim small">Place search is unavailable right now.</div>'; }
  }
  $('#sf-find').addEventListener('click', findPlace);
  f.placeq.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); findPlace(); } });
  f.placeq.addEventListener('input', () => { sfPlace = null; });

  f.addEventListener('submit', async e => {
    e.preventDefault();
    const st = $('#sf-status'); st.className = 'dim';
    const fail = m => { st.className = 'err'; st.textContent = m; };
    const id = videoIdFrom(f.url.value);
    if (!id) return fail('Please paste a YouTube live-stream link.');
    if (state.cams.some(c => c.id === id)) return fail('That camera is already on the globe.');
    if (f.name.value.trim().length < 2) return fail('Please give the camera a name.');
    if (!sfPlace) return fail('Please press Find and choose where the camera is.');
    if (!f.category.value) return fail('Please choose what the camera shows.');
    if (!f.own.checked || !f.public.checked) return fail('Please confirm both statements.');
    $('#sf-send').disabled = true; st.textContent = 'Checking the stream…';
    try {
      await submitCam({
        url: f.url.value, name: f.name.value, place: sfPlace.place, country: sfPlace.country, lat: sfPlace.lat, lon: sfPlace.lon,
        tz: guessTz(sfPlace.lon), category: f.category.value, contact: f.contact.value, note: f.note.value, website: f.website.value,
        owner_attested: f.own.checked, public_ok: f.public.checked,
      });
      st.className = 'ok'; st.textContent = 'Thank you! Your camera is in the review queue and will appear on the globe once it’s approved.';
      f.reset(); sfPlace = null; $('#sf-places').innerHTML = ''; $('#sf-preview').hidden = true;
      sound.chime();
    } catch (err) { fail(err.message); }
    finally { $('#sf-send').disabled = false; }
  });
}

function wireUI() {
  wireSubmit();
  const search = $('#search');
  search.addEventListener('input', () => runSearch(search.value));
  search.addEventListener('focus', () => search.value && runSearch(search.value));
  search.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { searchSel = Math.min(searchItems.length - 1, searchSel + 1); renderResults(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { searchSel = Math.max(0, searchSel - 1); renderResults(); e.preventDefault(); }
    else if (e.key === 'Enter') { chooseResult(searchSel >= 0 ? searchSel : searchItems.findIndex(x => x.type === 'place')); }
    else if (e.key === 'Escape') closeSearch();
  });
  $('#results').addEventListener('click', e => {
    const d = e.target.closest('[data-disc]'); if (d) return openDiscovered(d.dataset.disc);
    const b = e.target.closest('[data-i]'); if (b) chooseResult(+b.dataset.i);
  });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#searchbar')) $('#results').classList.remove('show'); });

  $('#chips').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (b) toggleCat(b.dataset.cat); });
  document.querySelectorAll('[data-tour]').forEach(b => b.addEventListener('click', () => state.tour?.mode === b.dataset.tour ? stopTour() : startTour(b.dataset.tour)));
  $('#btn-random').addEventListener('click', () => { const v = visibleCams(); openCam(v[Math.floor(Math.random() * v.length)]); });

  $('#w-close').addEventListener('click', closeWindow);
  $('#w-save').addEventListener('click', () => {
    if (!state.current) return;
    const now = gallery.toggle(state.current);
    toast(now ? 'Saved to My Gallery ★' : 'Removed from My Gallery');
    if (now) sound.chime();
  });
  $('#w-share').addEventListener('click', async () => {
    const url = location.origin + location.pathname + '#cam=' + state.current.id;
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link:', url); }
  });
  $('#w-wall').addEventListener('click', () => {
    const ids = [state.current.id, ...gallery.list().map(c => c.id).filter(id => id !== state.current.id)];
    openWall(ids);
  });
  $('#window').addEventListener('click', e => {
    const o = e.target.closest('[data-open]'); if (o) return openCam(o.dataset.open);
    if (e.target.closest('[data-next]')) { const n = nearestTo(state.current, 1)[0]; if (n) openCam(n.c); }
    if (e.target.closest('[data-skip]')) tourStep();
    if (e.target.closest('[data-stop]')) stopTour();
  });

  $('#btn-gallery').addEventListener('click', () => toggleDrawer());
  $('#gallery-close').addEventListener('click', () => toggleDrawer(false));
  $('#wall-close').addEventListener('click', closeWall);
  $('#wall-grid').addEventListener('click', e => { const b = e.target.closest('[data-wall-open]'); if (b) { const id = b.dataset.wallOpen; closeWall(); openCam(state.cams.find(c => c.id === id) || gallery.list().find(c => c.id === id)); } });

  $('#btn-settings').addEventListener('click', () => openModal('#settings'));
  $('#btn-about').addEventListener('click', () => openModal('#about'));
  document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) closeModals(); }));
  $('#key-save').addEventListener('click', async () => {
    const k = $('#yt-key').value.trim();
    setKey(k);
    if (!k) { fillSettings(); state.verified = false; state.offline.clear(); refreshFlags(); return toast('Key removed'); }
    $('#key-status').textContent = 'Testing key…';
    try { await verifyLive([state.catalog[0].id]); $('#key-status').textContent = 'Key works. Verifying the catalog…'; await verifyCatalog(true); fillSettings(); }
    catch (e) { $('#key-status').textContent = 'That key didn’t work: ' + e.message; }
  });
  $('#sound-toggle').addEventListener('change', e => sound.setEnabled(e.target.checked));
  $('#btn-sound').addEventListener('click', () => { sound.setEnabled(!sound.enabled); $('#btn-sound').classList.toggle('off', !sound.enabled); toast(sound.enabled ? 'Sound on' : 'Sound off'); });
  $('#btn-sound').classList.toggle('off', !sound.enabled);

  window.addEventListener('resize', () => requestAnimationFrame(panelShift));
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) return;
    if (e.key === 'Escape') { if ($('#wall').classList.contains('open')) closeWall(); else if (document.querySelector('.modal.open')) closeModals(); else if ($('#gallery-layer').classList.contains('open')) toggleDrawer(false); else closeWindow(); }
    else if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
    else if (e.key.toLowerCase() === 'r') $('#btn-random').click();
    else if (e.key.toLowerCase() === 's' && state.current) $('#w-save').click();
    else if (e.key.toLowerCase() === 'n' && state.current) { const n = nearestTo(state.current, 1)[0]; if (n) openCam(n.c); }
    else if (e.key.toLowerCase() === 'g') toggleDrawer();
  });
}

boot();
