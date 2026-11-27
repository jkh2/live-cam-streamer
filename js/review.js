// Reviewer page: approve or reject community camera submissions. Talks only to the `review-cams` Edge Function.
import { CONFIG, CATEGORIES } from './config.js';
import { thumbUrl, embedUrl, watchUrl } from './youtube.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'nowhere.adminkey';
let tab = 'pending', items = [];

const getKey = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
const setKey = k => { try { k ? localStorage.setItem(KEY, k) : localStorage.removeItem(KEY); } catch {} };

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }

async function call(method, body, query = '') {
  const h = { apikey: CONFIG.supabaseKey, 'x-admin-key': getKey() };
  if (CONFIG.supabaseKey.startsWith('eyJ')) h.Authorization = `Bearer ${CONFIG.supabaseKey}`;
  if (body) h['Content-Type'] = 'application/json';
  const r = await fetch(`${CONFIG.supabaseUrl}/functions/v1/review-cams${query}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { setKey(''); showLogin('That key didn’t work.'); throw new Error('locked'); }
  if (!r.ok || !j.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

function showLogin(msg = '') { $('#rv-login').hidden = false; $('#rv-list').innerHTML = ''; $('#rv-login-msg').textContent = msg; }

async function load() {
  if (!CONFIG.supabaseUrl) { $('#rv-list').innerHTML = '<div class="rv-empty">Submissions aren’t connected yet (set supabaseUrl and supabaseKey in js/config.js).</div>'; return; }
  if (!getKey()) return showLogin();
  $('#rv-login').hidden = true;
  $('#rv-list').innerHTML = '<div class="rv-empty">Loading…</div>';
  try {
    const j = await call('GET', null, `?status=${tab}`);
    items = j.items;
    for (const k of ['pending', 'approved', 'rejected']) $('#n-' + k).textContent = j.counts[k] || '';
    render();
  } catch (e) { if (e.message !== 'locked') $('#rv-list').innerHTML = `<div class="rv-empty">${esc(e.message)}</div>`; }
}

function render() {
  if (!items.length) { $('#rv-list').innerHTML = `<div class="rv-empty">${tab === 'pending' ? 'Nothing waiting for review. 🎉' : 'Nothing here yet.'}</div>`; return; }
  const cats = Object.entries(CATEGORIES).filter(([k]) => k !== 'discovered');
  $('#rv-list').innerHTML = items.map(c => `
    <article class="rv-item" data-id="${esc(c.id)}">
      <div>
        <div class="rv-video" data-vid="${esc(c.video_id)}"><img src="${thumbUrl(c.video_id, { size: 'hq' })}" alt=""><span class="play">▶ CLICK TO PREVIEW</span></div>
        <div class="rv-facts">
          <div><b>${esc(c.title || '(no title)')}</b></div>
          <div>by <a href="${esc(c.channel_url)}" target="_blank" rel="noopener">${esc(c.channel || 'unknown channel')}</a> · <a href="${watchUrl(c.video_id)}" target="_blank" rel="noopener">open on YouTube ↗</a></div>
          <div>Submitted ${new Date(c.created_at).toLocaleString()}${c.reviewed_at ? ` · reviewed ${new Date(c.reviewed_at).toLocaleString()}` : ''}</div>
          <div>Embeddable <span class="good">✓</span> · Live when submitted ${c.check_live === true ? '<span class="good">✓</span>' : c.check_live === false ? '<span class="warn">✗</span>' : '<span class="warn">not checked (no API key)</span>'} · Owner attested <span class="good">✓</span></div>
          <div><a href="https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=15/${c.lat}/${c.lon}" target="_blank" rel="noopener">Check the location on a map ↗</a></div>
        </div>
      </div>
      <form class="rv-form">
        <label>Name<input name="name" value="${esc(c.name)}" maxlength="80"></label>
        <label>What it shows<select name="category">${cats.map(([k, v]) => `<option value="${k}" ${k === c.category ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
        <label>Place<input name="place" value="${esc(c.place)}" maxlength="120"></label>
        <label>Country<input name="country" value="${esc(c.country)}" maxlength="80"></label>
        <label class="w2">Latitude<input name="lat" value="${c.lat}" inputmode="decimal"></label>
        <label class="w2">Longitude<input name="lon" value="${c.lon}" inputmode="decimal"></label>
        <label class="w2">Time zone<input name="tz" value="${esc(c.tz)}" placeholder="America/Denver"></label>
        ${c.contact || c.note ? `<div class="rv-quote">${c.contact ? `<b>Contact:</b> ${esc(c.contact)}<br>` : ''}${c.note ? `<b>Note:</b> ${esc(c.note)}` : ''}</div>` : ''}
        <label class="w6">Review note <em>(private)</em><textarea name="note">${esc(c.review_note)}</textarea></label>
        <div class="rv-actions">
          ${tab !== 'approved' ? '<button type="button" class="btn good" data-act="approve">✓ Approve &amp; publish</button>' : '<button type="button" class="btn" data-act="approve">Save changes</button>'}
          ${tab !== 'rejected' ? `<button type="button" class="btn bad" data-act="reject">${tab === 'approved' ? 'Unpublish' : '✕ Reject'}</button>` : ''}
          ${tab !== 'pending' ? '<button type="button" class="btn ghost" data-act="pending">Move back to pending</button>' : ''}
        </div>
      </form>
    </article>`).join('');
}

$('#rv-list').addEventListener('click', async e => {
  const v = e.target.closest('.rv-video');
  if (v && !v.querySelector('iframe')) { v.innerHTML = `<iframe src="${embedUrl(v.dataset.vid)}" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>`; return; }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const art = b.closest('.rv-item'), f = art.querySelector('form');
  const edits = Object.fromEntries(['name', 'category', 'place', 'country', 'lat', 'lon', 'tz'].map(k => [k, f[k].value]));
  b.disabled = true;
  try {
    await call('POST', { id: art.dataset.id, action: b.dataset.act, note: f.note.value, edits });
    toast({ approve: tab === 'approved' ? 'Saved' : 'Approved: it’s on the globe now', reject: tab === 'approved' ? 'Unpublished' : 'Rejected', pending: 'Moved back to pending' }[b.dataset.act]);
    load();
  } catch (err) { if (err.message !== 'locked') toast(err.message); b.disabled = false; }
});

document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
  tab = b.dataset.tab;
  document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b));
  load();
}));
$('#rv-key-form').addEventListener('submit', e => { e.preventDefault(); setKey($('#rv-key').value.trim()); $('#rv-key').value = ''; load(); });
$('#rv-lock').addEventListener('click', () => { setKey(''); showLogin('Locked.'); });

load();
