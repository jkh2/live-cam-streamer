// Solar position math (NOAA-style low-precision formulas, accurate to well under a degree).
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Returns { lat, lon } of the subsolar point (where the sun is directly overhead) for a Date. */
export function subsolarPoint(date = new Date()) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * D2R;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 0.0000004 * n) * D2R;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24; // hours
  let lon = ra * R2D - gmst * 15;
  lon = ((lon + 540) % 360) - 180;
  return { lat: decl * R2D, lon };
}

/** Sun elevation in degrees above the horizon at lat/lon. */
export function sunElevation(lat, lon, sub = subsolarPoint()) {
  const a = lat * D2R, b = sub.lat * D2R, dl = (lon - sub.lon) * D2R;
  const s = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(dl);
  return Math.asin(Math.max(-1, Math.min(1, s))) * R2D;
}

/** Local apparent solar hour (0-24) at a longitude. */
export function solarHour(lon, sub = subsolarPoint()) {
  return (((12 + (lon - sub.lon) / 15) % 24) + 24) % 24;
}

/** Human-readable light state for a place. */
export function lightState(lat, lon, sub = subsolarPoint()) {
  const el = sunElevation(lat, lon, sub);
  const morning = solarHour(lon, sub) < 12;
  let key, label, icon;
  if (el > 8) { key = 'day'; label = 'Daylight'; icon = '☀'; }
  else if (el > -4) { key = 'golden'; label = morning ? 'Golden hour · sunrise' : 'Golden hour · sunset'; icon = morning ? '🌅' : '🌇'; }
  else if (el > -12) { key = 'twilight'; label = morning ? 'Dawn twilight' : 'Dusk twilight'; icon = '🌆'; }
  else { key = 'night'; label = 'Night'; icon = '🌙'; }
  return { key, label, icon, elevation: el, morning };
}

/** Great-circle distance in km. */
export function distanceKm(aLat, aLon, bLat, bLon) {
  const dLat = (bLat - aLat) * D2R, dLon = (bLon - aLon) * D2R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * D2R) * Math.cos(bLat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
