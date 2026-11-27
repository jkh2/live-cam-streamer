// Community cameras: approved submissions (read-only, public) and the "Add your camera" submit call.
import { CONFIG } from './config.js';

export const communityEnabled = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseKey);

function headers(extra = {}) {
  const h = { apikey: CONFIG.supabaseKey, ...extra };
  if (CONFIG.supabaseKey.startsWith('eyJ')) h.Authorization = `Bearer ${CONFIG.supabaseKey}`; // legacy anon JWT
  return h;
}

const PUBLIC_COLS = 'video_id,name,place,country,lat,lon,tz,category,channel,channel_url,title';

/** Approved community cams, shaped like catalog cams. Fails quietly (returns []) if the backend is asleep. */
export async function loadCommunityCams() {
  if (!communityEnabled()) return [];
  try {
    const u = `${CONFIG.supabaseUrl}/rest/v1/cam_submissions?select=${PUBLIC_COLS}&status=eq.approved&order=reviewed_at.desc&limit=2000`;
    const r = await fetch(u, { headers: headers() });
    if (!r.ok) return [];
    return (await r.json()).map(c => ({
      id: c.video_id, name: c.name, place: c.place, country: c.country || '', lat: c.lat, lon: c.lon, tz: c.tz || '',
      category: c.category, source: 'youtube', community: true,
      channel: c.channel || 'YouTube', channelUrl: c.channel_url || `https://www.youtube.com/watch?v=${c.video_id}`, title: c.title || c.name,
    }));
  } catch { return []; }
}

export async function submitCam(payload) {
  if (!communityEnabled()) throw new Error('Submissions aren’t open yet.');
  const r = await fetch(`${CONFIG.supabaseUrl}/functions/v1/submit-cam`, {
    method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(payload),
  });
  let j = {};
  try { j = await r.json(); } catch {}
  if (!r.ok || !j.ok) { const e = new Error(j.error || `Submission failed (${r.status})`); e.duplicate = !!j.duplicate; throw e; }
  return j;
}

export function videoIdFrom(input) {
  const s = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1, 12) || null;
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v'); if (v) return v.slice(0, 11);
      const m = u.pathname.match(/\/(?:live|embed|shorts|v)\/([A-Za-z0-9_-]{11})/); if (m) return m[1];
    }
  } catch {}
  return null;
}

/** Best-guess IANA zone for a spot: the submitter's own zone if it matches the longitude, else a fixed offset. */
export function guessTz(lon) {
  const solar = Math.round(lon / 15);
  try {
    const mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offsetHours = -new Date().getTimezoneOffset() / 60;
    if (Math.abs(offsetHours - lon / 15) <= 1.6) return mine;
  } catch {}
  if (solar === 0) return 'Etc/GMT';
  return `Etc/GMT${solar > 0 ? '-' : '+'}${Math.abs(solar)}`; // Etc/GMT signs are inverted by design
}
