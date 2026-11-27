// Tiny synthesized UI sounds (no audio files). Off until the first user gesture, per browser rules.
const KEY = 'nowhere.sound';
let ctx = null, lastTick = 0;
function ac() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
let enabled = true;
try { enabled = localStorage.getItem(KEY) !== 'off'; } catch {}

function noiseBuffer(c, secs) {
  const b = c.createBuffer(1, c.sampleRate * secs, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

export const sound = {
  get enabled() { return enabled; },
  setEnabled(on) { enabled = on; try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch {} },
  whoosh() {
    if (!enabled) return; const c = ac(); if (!c) return;
    const t = c.currentTime, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = noiseBuffer(c, 1.6);
    f.type = 'bandpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(180, t); f.frequency.exponentialRampToValueAtTime(1400, t + 0.7); f.frequency.exponentialRampToValueAtTime(260, t + 1.5);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.45); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.55);
    src.connect(f).connect(g).connect(c.destination); src.start(t); src.stop(t + 1.6);
  },
  chime() {
    if (!enabled) return; const c = ac(); if (!c) return;
    const t = c.currentTime;
    [880, 1318.5, 1760].forEach((fr, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = fr;
      g.gain.setValueAtTime(0.0001, t + i * 0.07); g.gain.exponentialRampToValueAtTime(0.05, t + i * 0.07 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.07 + 0.9);
      o.connect(g).connect(c.destination); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 1);
    });
  },
  tick() {
    if (!enabled || !ctx) return; // only after the user has interacted once
    const now = performance.now(); if (now - lastTick < 60) return; lastTick = now;
    const c = ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(2200, t); o.frequency.exponentialRampToValueAtTime(1500, t + 0.04);
    g.gain.setValueAtTime(0.012, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.07);
  },
};
window.addEventListener('pointerdown', () => { if (enabled) ac(); }, { once: true });
