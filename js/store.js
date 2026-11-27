// Sentinel Vantage · My Gallery: saved cams, kept in this browser (localStorage), with an in-memory fallback.
// This module is the single source of truth for saved cams. Any UI (including the
// gallery view) reads and writes through it, and listens for changes.

const KEY = 'nowhere.gallery.v1';
const EVENT = 'nowhere:gallery-changed';
let memory = null; // fallback when storage is blocked

// Fields kept for each saved cam (see docs/gallery-integration.md for meanings).
const FIELDS = ['id', 'source', 'name', 'place', 'country', 'lat', 'lon', 'tz', 'category', 'channel', 'channelUrl', 'title', 'approx'];

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const doc = JSON.parse(raw);
      if (doc && Array.isArray(doc.items)) return doc.items;
    }
    return memory || [];
  } catch { return memory || []; }
}

function write(items) {
  memory = items;
  try { localStorage.setItem(KEY, JSON.stringify({ version: 1, items })); } catch { /* storage blocked: keep in memory */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { items: items.slice() } }));
}

function clean(cam) {
  const out = {};
  for (const f of FIELDS) if (cam[f] !== undefined) out[f] = cam[f];
  out.source = out.source || 'youtube';
  out.savedAt = cam.savedAt || new Date().toISOString();
  return out;
}

export const gallery = {
  list: () => read(),
  has: id => read().some(c => c.id === id),
  add(cam) {
    const items = read();
    if (items.some(c => c.id === cam.id)) return false;
    items.unshift(clean(cam));
    write(items);
    return true;
  },
  remove(id) { write(read().filter(c => c.id !== id)); },
  toggle(cam) { if (gallery.has(cam.id)) { gallery.remove(cam.id); return false; } gallery.add(cam); return true; },
  /** Reorder: pass the full list of ids in the new order. */
  reorder(ids) {
    const map = new Map(read().map(c => [c.id, c]));
    const next = ids.map(id => map.get(id)).filter(Boolean);
    for (const c of map.values()) if (!ids.includes(c.id)) next.push(c);
    write(next);
  },
  clear() { write([]); },
  exportJSON() { return JSON.stringify({ app: 'sentinel-vantage', version: 1, exportedAt: new Date().toISOString(), items: read() }, null, 1); },
  /** Merge an exported file into the gallery. Returns number of cams added. */
  importJSON(text) {
    const doc = JSON.parse(text);
    const incoming = Array.isArray(doc) ? doc : doc.items;
    if (!Array.isArray(incoming)) throw new Error('Not a Sentinel Vantage gallery file');
    const items = read(); let added = 0;
    for (const c of incoming) {
      if (!c || typeof c.id !== 'string' || !/^[\w-]{11}$/.test(c.id)) continue;
      if (items.some(x => x.id === c.id)) continue;
      items.push(clean(c)); added++;
    }
    write(items);
    return added;
  },
  /** Subscribe to changes. Returns an unsubscribe function. */
  onChange(fn) {
    const h = e => fn(e.detail.items);
    window.addEventListener(EVENT, h);
    window.addEventListener('storage', e => { if (e.key === KEY) fn(read()); });
    return () => window.removeEventListener(EVENT, h);
  },
};

// Ask the main app to open a cam (fly the globe there and open its window).
// detail: { id } for a catalog/gallery cam, or { cam } for a full cam object.
export function requestOpenCam(detail) {
  window.dispatchEvent(new CustomEvent('nowhere:open-cam', { detail }));
}
