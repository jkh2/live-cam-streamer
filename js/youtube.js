// YouTube helpers: embeds, live thumbnails, and optional bring-your-own-key verification + discovery.
const KEY_STORE = 'nowhere.ytkey';

export function thumbUrl(id, { size = 'hq', bust = false } = {}) {
  const name = { hq: 'hqdefault_live', mq: 'mqdefault_live', maxres: 'maxresdefault_live', sd: 'sddefault_live' }[size] || 'hqdefault_live';
  return `https://i.ytimg.com/vi/${id}/${name}.jpg` + (bust ? `?t=${Math.floor(Date.now() / 60000)}` : '');
}

export function embedUrl(id, { controls = true, autoplay = true, mute = true, api = false } = {}) {
  const p = new URLSearchParams({ autoplay: autoplay ? 1 : 0, mute: mute ? 1 : 0, playsinline: 1, rel: 0, modestbranding: 1, controls: controls ? 1 : 0 });
  if (api) { p.set('enablejsapi', 1); p.set('origin', location.origin); }
  return `https://www.youtube-nocookie.com/embed/${id}?${p}`;
}

export const watchUrl = id => `https://www.youtube.com/watch?v=${id}`;

export function getKey() { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } }
export function setKey(k) { try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); } catch {} }

async function api(path, params) {
  const key = getKey();
  if (!key) throw new Error('No YouTube API key set');
  const u = new URL('https://www.googleapis.com/youtube/v3/' + path);
  for (const [k, v] of Object.entries({ ...params, key })) u.searchParams.set(k, v);
  const r = await fetch(u);
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || `YouTube API error ${r.status}`);
  return j;
}

/** Check which ids are live right now and still embeddable. Costs 1 quota unit per 50 ids. */
export async function verifyLive(ids) {
  const status = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const j = await api('videos', { part: 'snippet,status', id: chunk.join(','), maxResults: 50 });
    const seen = new Set();
    for (const v of j.items || []) {
      seen.add(v.id);
      status.set(v.id, { live: v.snippet.liveBroadcastContent === 'live', embeddable: v.status.embeddable !== false });
    }
    for (const id of chunk) if (!seen.has(id)) status.set(id, { live: false, embeddable: false, missing: true });
  }
  return status;
}

/** Search live, embeddable streams. Costs 100 quota units per call (10,000/day free). */
export async function searchLive(q, max = 12) {
  const j = await api('search', { part: 'snippet', type: 'video', eventType: 'live', videoEmbeddable: 'true', maxResults: max, q, safeSearch: 'strict' });
  return (j.items || []).map(it => ({
    id: it.id.videoId,
    title: decode(it.snippet.title),
    channel: decode(it.snippet.channelTitle),
    channelUrl: `https://www.youtube.com/channel/${it.snippet.channelId}`,
    thumb: it.snippet.thumbnails?.medium?.url,
  }));
}

function decode(s) { const t = document.createElement('textarea'); t.innerHTML = s; return t.value; }

/** Load the IFrame Player API once. */
let ytReady;
export function loadPlayerAPI() {
  if (ytReady) return ytReady;
  ytReady = new Promise(res => {
    if (window.YT?.Player) return res(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev && prev(); res(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => res(null);
    document.head.appendChild(s);
    setTimeout(() => res(window.YT?.Player ? window.YT : null), 8000);
  });
  return ytReady;
}
