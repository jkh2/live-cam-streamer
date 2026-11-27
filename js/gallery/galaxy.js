// The "My Galaxy" scene: every saved live cam is a star in a spiral galaxy that grows with each save.
// WebGL draws the stars; the nearest few bloom into live thumbnail cards drawn as real DOM elements
// in 3D (CSS3DRenderer), because YouTube thumbnails can't be WebGL textures (no CORS header).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';

// ---------- deterministic randomness: a star's place depends only on its cam ----------
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = r => { const u = Math.max(1e-6, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

const ARMS = 4;
const ARM_OF = { city: 0, port: 0, aviation: 0, rail: 1, mountain: 1, discovered: 1, nature: 2, beach: 2, underwater: 2, wildlife: 3, sky: 3 };
const radiusFor = i => 3.5 + 3.1 * Math.sqrt(i + 1);

export function starPosition(cam, index) {
  const r = rng(hash(cam.id));
  const arm = ARM_OF[cam.category] ?? (hash(cam.category || '') % ARMS);
  const rad = radiusFor(index) * (0.92 + r() * 0.16);
  const ang = arm * (Math.PI * 2 / ARMS) + Math.log(rad) * 1.85 + gauss(r) * 0.16;
  const y = gauss(r) * (0.35 + rad * 0.035);
  return new THREE.Vector3(Math.cos(ang) * rad, y, Math.sin(ang) * rad);
}

// ---------- shaders ----------
const starVert = /* glsl */`
  attribute vec3 color; attribute float size; attribute float phase; attribute float golden; attribute float hl; attribute float born;
  uniform float time; uniform float px;
  varying vec3 vColor; varying float vAlpha; varying float vFlash;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float age = time - born;
    float grow = born < 0.0 ? 1.0 : smoothstep(0.0, 1.6, age);
    vFlash = born < 0.0 ? 0.0 : exp(-age * 1.3);
    float tw = 0.82 + 0.18 * sin(time * (1.3 + golden * 1.6) + phase);
    float s = size * tw * grow * (1.0 + hl * 0.9) + vFlash * 10.0;
    gl_PointSize = clamp(max(s * px * 150.0 / max(-mv.z, 0.5), (5.0 + golden * 2.0 + hl * 4.0) * px * grow), 0.0, 260.0);
    vColor = mix(color, vec3(1.0, 0.8, 0.45), golden * 0.6);
    vAlpha = smoothstep(800.0, 300.0, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const starFrag = /* glsl */`
  varying vec3 vColor; varying float vAlpha; varying float vFlash;
  void main(){
    vec2 c = gl_PointCoord - 0.5; float r = length(c);
    if (r > 0.5) discard;
    float halo = exp(-r * r * 26.0);
    float core = smoothstep(0.1, 0.0, r);
    float spikes = (exp(-abs(c.x) * 70.0) + exp(-abs(c.y) * 70.0)) * exp(-r * 7.0) * 0.55;
    vec3 col = vColor * (halo * 1.2 + spikes) + vec3(1.0) * core + vec3(1.0, 0.9, 0.7) * vFlash * halo;
    gl_FragColor = vec4(col, (halo + core + spikes) * vAlpha);
  }`;
const dustVert = /* glsl */`
  attribute vec3 color; attribute float size; uniform float px;
  varying vec3 vColor;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(size * px * 30.0 / max(-mv.z, 0.5), 0.0, 60.0);
    vColor = color;
    gl_Position = projectionMatrix * mv;
  }`;
const dustFrag = /* glsl */`
  varying vec3 vColor;
  void main(){ vec2 c = gl_PointCoord - 0.5; float a = exp(-dot(c, c) * 18.0); gl_FragColor = vec4(vColor * a, a); }`;

function glowTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(0.35, outer); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const CARD_W = 300, CARD_SCALE = 0.0056;

export class Galaxy {
  constructor(host, api, { onHover, onCount, onFocus } = {}) {
    this.host = host; this.api = api;
    this.onFocus = onFocus || (() => {});
    this.onHover = onHover || (() => {});
    this.onCount = onCount || (() => {});
    this.items = []; this.positions = []; this.index = new Map();
    this.running = false; this.flight = null; this.keys = new Set();
    this.mobile = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
    this.K = this.mobile ? 8 : 12;
    this.maxFrames = this.mobile ? 1 : 3;
    this.bloomRange = 13;
    this.cards = new Map();  // id -> card record
    this.pool = [];
    this.frames = [];        // live iframe previews (ids), oldest first
    this.highlight = new Set();
    this._t0 = performance.now();

    const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.setSize(w, h);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.domElement.className = 'g-webgl';
    host.appendChild(r.domElement);

    const cr = this.css = new CSS3DRenderer();
    cr.setSize(w, h);
    cr.domElement.className = 'g-css';
    host.appendChild(cr.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02040b);
    this.scene.fog = null;
    this.cssScene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, w / h, 0.05, 4000);
    this.camera.position.set(0, 40, 60);

    const c = this.controls = new OrbitControls(this.camera, r.domElement);
    c.enableDamping = true; c.dampingFactor = 0.07; c.rotateSpeed = 0.5; c.zoomSpeed = 0.9; c.panSpeed = 0.8;
    c.screenSpacePanning = true; c.minDistance = 2; c.maxDistance = 1500;
    c.autoRotate = true; c.autoRotateSpeed = 0.15;
    c.addEventListener('start', () => { this.flight = null; c.autoRotate = false; });

    this.uniforms = { time: { value: 0 }, px: { value: r.getPixelRatio() * h / 900 } };
    this._buildBackdrop();

    this._pointer = { x: -1, y: -1, down: false, dx: 0, dy: 0 };
    const el = r.domElement;
    el.addEventListener('pointermove', e => { this._pointer.x = e.clientX; this._pointer.y = e.clientY; this._pickPending = true; });
    el.addEventListener('pointerdown', e => { this._pointer.down = true; this._pointer.dx = e.clientX; this._pointer.dy = e.clientY; });
    el.addEventListener('pointerup', e => {
      this._pointer.down = false;
      if (Math.hypot(e.clientX - this._pointer.dx, e.clientY - this._pointer.dy) > 6) return;
      // Cards are drawn by CSS3D, but browsers don't hit-test them reliably, so we test them ourselves.
      const cardId = this._cardAt(e.clientX, e.clientY);
      if (cardId) { const cam = this.items[this.index.get(cardId)]; if (cam) { this.onFocus(cam); this.api.openCam(cam); } return; }
      const i = this._pick(e.clientX, e.clientY);
      if (i >= 0) { this.flyToStar(i); this.onFocus(this.items[i]); }
    });
    el.addEventListener('pointerleave', () => { this._pointer.x = -1; this._setHover(-1); this._setCardHover(null); });
    this._onKeyDown = e => { if (!this.running || e.target.matches('input, textarea')) return; this.keys.add(e.key.toLowerCase()); };
    this._onKeyUp = e => this.keys.delete(e.key.toLowerCase());
    this._onResize = () => this.resize();
    addEventListener('keydown', this._onKeyDown); addEventListener('keyup', this._onKeyUp); addEventListener('resize', this._onResize);

    this._loop = this._loop.bind(this);
  }

  _buildBackdrop() {
    // far starfield
    const n = 6000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
    const R = rng(7);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(gauss(R), gauss(R), gauss(R)).normalize().multiplyScalar(900 + R() * 900);
      pos.set([v.x, v.y, v.z], i * 3);
      const t = R(), b = 0.25 + R() * 0.6;
      const cc = t < 0.12 ? [1, .8, .65] : t < 0.3 ? [.7, .8, 1] : [1, 1, 1];
      col.set(cc.map(x => x * b), i * 3); size[i] = 8 + R() * 22;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    this.sky = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: dustVert, fragmentShader: dustFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(this.sky);

    this.dustGroup = new THREE.Group();
    this.scene.add(this.dustGroup);

    // galactic core glow
    this.core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,236,200,0.95)', 'rgba(255,170,90,0.25)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.scene.add(this.core);
    this.nebulaTex = [glowTexture('rgba(120,170,255,0.35)', 'rgba(60,90,200,0.10)'), glowTexture('rgba(200,120,255,0.30)', 'rgba(110,60,180,0.08)'), glowTexture('rgba(255,180,120,0.28)', 'rgba(170,90,60,0.08)')];
  }

  /** Procedural dust & nebulae shaped to the galaxy's current size, so even 1 star sits in a beautiful place. */
  _buildDust(rmax) {
    for (const o of [...this.dustGroup.children]) { this.dustGroup.remove(o); o.geometry?.dispose(); o.material?.dispose(); }
    const R = rng(42), n = Math.min(14000, 3000 + Math.floor(rmax * 60));
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
    const span = rmax + 18;
    for (let i = 0; i < n; i++) {
      const arm = i % ARMS;
      const rad = Math.pow(R(), 0.65) * span + 1.5;
      const ang = arm * (Math.PI * 2 / ARMS) + Math.log(rad) * 1.85 + gauss(R) * (0.22 + 0.35 * (1 - rad / span));
      const y = gauss(R) * (0.5 + rad * 0.045);
      pos.set([Math.cos(ang) * rad, y, Math.sin(ang) * rad], i * 3);
      const k = rad / span;
      const warm = [1.0, 0.78, 0.55], cool = [0.45, 0.62, 1.0];
      const b = (0.10 + R() * 0.22) * (1.35 - k);
      col.set(warm.map((w, j) => (w * (1 - k) + cool[j] * k) * b), i * 3);
      size[i] = 3 + R() * 8;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    this.dustGroup.add(new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: dustVert, fragmentShader: dustFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));

    const NR = rng(99);
    for (let i = 0; i < 18; i++) {
      const arm = i % ARMS, rad = 4 + NR() * span * 0.9;
      const ang = arm * (Math.PI * 2 / ARMS) + Math.log(rad) * 1.85 + gauss(NR) * 0.2;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.nebulaTex[i % 3], blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.32 }));
      s.position.set(Math.cos(ang) * rad, gauss(NR) * 1.5, Math.sin(ang) * rad);
      s.scale.setScalar(8 + rad * 0.55 + NR() * 10);
      this.dustGroup.add(s);
    }
    this.core.scale.setScalar(10 + rmax * 0.12);
  }

  /** Rebuild stars from the gallery. `fresh` = ids just saved (they get a birth animation). */
  setItems(list, fresh = new Set()) {
    const now = (performance.now() - this._t0) / 1000;
    const prevBorn = new Map();
    if (this.stars) { const b = this.stars.geometry.attributes.born.array; this.items.forEach((c, i) => prevBorn.set(c.id, b[i])); }
    // oldest first, so the galaxy grows outward with each save
    this.items = [...list].sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt)) || a.id.localeCompare(b.id));
    this.index = new Map(this.items.map((c, i) => [c.id, i]));
    this.positions = this.items.map((c, i) => starPosition(c, i));
    this.rmax = this.items.length ? radiusFor(this.items.length) : 4;

    if (this.stars) { this.scene.remove(this.stars, this.lines); this.stars.geometry.dispose(); this.lines.geometry.dispose(); }
    const n = this.items.length;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), phase = new Float32Array(n),
      golden = new Float32Array(n), hl = new Float32Array(n), born = new Float32Array(n);
    this.items.forEach((c, i) => {
      const p = this.positions[i]; pos.set([p.x, p.y, p.z], i * 3);
      phase[i] = (hash(c.id) % 1000) / 160;
      born[i] = fresh.has(c.id) ? now : (prevBorn.get(c.id) ?? -1);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    g.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('golden', new THREE.BufferAttribute(golden, 1));
    g.setAttribute('hl', new THREE.BufferAttribute(hl, 1));
    g.setAttribute('born', new THREE.BufferAttribute(born, 1));
    this.stars = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: starVert, fragmentShader: starFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(this.stars);
    this.refreshLight();

    // faint constellation threads: each star linked to the previous star saved in the same arm
    const lastInArm = new Map(), seg = [], segCol = [];
    this.items.forEach((c, i) => {
      const arm = ARM_OF[c.category] ?? 1;
      if (lastInArm.has(arm)) {
        const a = this.positions[lastInArm.get(arm)], b = this.positions[i];
        if (false) { seg.push(a.x, a.y, a.z, b.x, b.y, b.z); const k = this._color(c); segCol.push(...k, ...k); }
      }
      lastInArm.set(arm, i);
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(segCol, 3));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.11, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.lines);

    if (!this._dustFor || Math.abs(this._dustFor - this.rmax) > 4) { this._buildDust(this.rmax); this._dustFor = this.rmax; }
    // drop cards for removed cams
    for (const id of [...this.cards.keys()]) if (!this.index.has(id)) this._release(id);
    this.onCount(n);
  }

  _color(c) {
    const hex = (this.api.categories[c.category] || this.api.categories.discovered).color;
    return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  }

  /** Daylight cams burn bright, golden-hour cams glow gold and pulse, night cams dim to blue. */
  refreshLight() {
    if (!this.stars) return;
    const a = this.stars.geometry.attributes;
    this.items.forEach((c, i) => {
      const ls = this.api.lightState(c.lat, c.lon);
      let k = this._color(c), s = 1.0;
      if (ls.key === 'night') { k = k.map((v, j) => v * 0.55 + [0.15, 0.2, 0.45][j]); s = 0.75; }
      else if (ls.key === 'twilight') { s = 0.85; }
      else if (ls.key === 'day') { s = 1.15; }
      a.color.array.set(k, i * 3);
      a.size.array[i] = s;
      a.golden.array[i] = ls.key === 'golden' ? 1 : 0;
    });
    a.color.needsUpdate = a.size.needsUpdate = a.golden.needsUpdate = true;
  }

  setHighlight(ids) {
    this.highlight = new Set(ids);
    if (!this.stars) return;
    const hl = this.stars.geometry.attributes.hl;
    this.items.forEach((c, i) => { hl.array[i] = this.highlight.has(c.id) ? 1 : (i === this.hoverIndex ? 0.6 : 0); });
    hl.needsUpdate = true;
  }

  // ---------- camera ----------
  overview(duration = 1800) {
    const d = Math.max(24, this.rmax * 2.1);
    this._fly(new THREE.Vector3(0, d * 0.62, d * 0.82), new THREE.Vector3(0, 0, 0), duration);
    this.controls.autoRotate = true;
  }

  flyToStar(i, dist) {
    const p = this.positions[i]; if (!p) return;
    dist = dist ?? (this.camera.aspect < 0.8 ? 6.2 : 3.3); // portrait phones need more room for the card
    const dir = this.camera.position.clone().sub(p).normalize();
    if (dir.lengthSq() < 0.5) dir.set(0, 0.4, 1).normalize();
    dir.y = Math.max(dir.y, 0.18); dir.normalize();
    this._fly(p.clone().add(dir.multiplyScalar(dist)), p.clone(), 1500);
    this.controls.autoRotate = false;
  }

  flyToId(id) { const i = this.index.get(id); if (i !== undefined) this.flyToStar(i); }

  _fly(toPos, toTarget, duration) {
    this.flight = { t0: performance.now(), duration, fromPos: this.camera.position.clone(), fromTarget: this.controls.target.clone(), toPos, toTarget };
  }

  // ---------- picking ----------
  _project(p) {
    const v = p.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: (v.x + 1) / 2 * rect.width + rect.left, y: (1 - v.y) / 2 * rect.height + rect.top, z: v.z };
  }
  _pick(x, y) {
    let best = -1, bd = 20 * 20;
    for (let i = 0; i < this.positions.length; i++) {
      const s = this._project(this.positions[i]);
      if (s.z > 1 || s.z < -1) continue;
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  _setHover(i) {
    if (i === this.hoverIndex) return;
    this.hoverIndex = i;
    this.renderer.domElement.style.cursor = i >= 0 ? 'pointer' : 'grab';
    this.setHighlight([...this.highlight]);
    this.onHover(i >= 0 ? this.items[i] : null, this._pointer);
  }

  // ---------- bloom cards ----------
  _makeCard() {
    const el = document.createElement('div');
    el.className = 'g-card';
    el.style.width = CARD_W + 'px';
    el.innerHTML = `<div class="g-thumb"><img alt="" draggable="false"><div class="g-frame"></div><span class="g-live">LIVE</span><span class="g-sun"></span></div>
      <div class="g-info"><b class="g-name"></b><small class="g-place"></small><small class="g-by"></small></div>`;
    const obj = new CSS3DObject(el);
    obj.scale.setScalar(CARD_SCALE);
    const img = el.querySelector('img');
    img.addEventListener('error', () => { img.dataset.failed = '1'; });
    img.addEventListener('load', () => { delete img.dataset.failed; });
    return { el, obj, img, frame: el.querySelector('.g-frame') };
  }

  _fillCard(card, cam) {
    const { el, img } = card;
    el.dataset.id = cam.id;
    el.style.setProperty('--c', (this.api.categories[cam.category] || this.api.categories.discovered).color);
    el.querySelector('.g-name').textContent = cam.name;
    const ls = this.api.lightState(cam.lat, cam.lon);
    el.querySelector('.g-place').textContent = `${cam.approx ? '≈ ' : ''}${cam.place}${cam.country && cam.country !== cam.place ? ' · ' + cam.country : ''}${cam.tz ? ' · ' + this.api.localTime(cam.tz) : ''}`;
    el.querySelector('.g-by').textContent = cam.channel ? `by ${cam.channel}` : '';
    const sun = el.querySelector('.g-sun'); sun.textContent = ls.icon; sun.title = ls.label;
    el.classList.toggle('golden', ls.key === 'golden');
    el.style.setProperty('--kb', `${(hash(cam.id) % 900) / 100}s`);
    img.src = this.api.thumbUrl(cam.id, { size: 'mq', bust: true });
    card.refreshedAt = performance.now();
    card.frame.innerHTML = '';
  }

  _acquire(id) {
    if (this.cards.has(id)) return this.cards.get(id);
    const card = this.pool.pop() || this._makeCard();
    this._fillCard(card, this.items[this.index.get(id)]);
    card.id = id; card.fade = 0;
    this.cssScene.add(card.obj);
    this.cards.set(id, card);
    return card;
  }

  _release(id) {
    const card = this.cards.get(id); if (!card) return;
    this._stopFrame(id);
    this.cssScene.remove(card.obj);
    card.el.classList.remove('hover');
    this.cards.delete(id);
    if (this.hoverCard === id) this.hoverCard = null;
    if (this.pool.length < 32) this.pool.push(card);
  }

  /** Which bloomed card (if any) is under a screen point: project each card's corners, test the quad. */
  _cardAt(x, y) {
    let best = null, bestD = Infinity;
    const v = new THREE.Vector3(), rect = this.renderer.domElement.getBoundingClientRect();
    for (const [id, card] of this.cards) {
      if (!card.obj.visible || card.fade < 0.5) continue;
      const w = CARD_W / 2, h = (card.h || (card.h = card.el.offsetHeight || 260)) / 2;
      card.obj.updateMatrixWorld();
      const pts = [[-w, h], [w, h], [w, -h], [-w, -h]].map(([px, py]) => {
        v.set(px, py, 0).applyMatrix4(card.obj.matrixWorld).project(this.camera);
        return [(v.x + 1) / 2 * rect.width + rect.left, (1 - v.y) / 2 * rect.height + rect.top, v.z];
      });
      if (pts.some(p => p[2] > 1)) continue;
      let inside = true;
      for (let k = 0; k < 4; k++) {
        const [ax, ay] = pts[k], [bx, by] = pts[(k + 1) % 4];
        const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
        if (k === 0) card._sign = Math.sign(cross); else if (Math.sign(cross) !== card._sign && cross !== 0) { inside = false; break; }
      }
      if (!inside) continue;
      const d = this.camera.position.distanceToSquared(card.obj.position);
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  _setCardHover(id) {
    if (id === this.hoverCard) return;
    if (this.hoverCard) this._hoverCard(this.hoverCard, false);
    this.hoverCard = id;
    if (id) this._hoverCard(id, true);
  }

  _hoverCard(id, on) {
    const card = this.cards.get(id); if (!card) return;
    card.el.classList.toggle('hover', on);
    clearTimeout(card.hoverTimer);
    if (on) card.hoverTimer = setTimeout(() => this._startFrame(id), 650);
    else card.hoverTimer = setTimeout(() => this._stopFrame(id), 1200);
  }

  /** Swap a card's still for a muted live embed. Hard-capped; the oldest preview is retired first. */
  _startFrame(id) {
    const card = this.cards.get(id); if (!card || card.live) return;
    while (this.frames.length >= this.maxFrames) this._stopFrame(this.frames[0]);
    card.frame.innerHTML = `<iframe src="${this.api.embedUrl(id, { controls: false })}" allow="autoplay; encrypted-media" tabindex="-1" title=""></iframe>`;
    card.live = true; card.el.classList.add('playing');
    card.frameStarted = performance.now();
    this.frames.push(id);
  }

  _stopFrame(id) {
    const card = this.cards.get(id);
    this.frames = this.frames.filter(f => f !== id);
    if (!card || !card.live) return;
    card.frame.innerHTML = ''; card.live = false; card.el.classList.remove('playing');
  }

  stopAllFrames() { for (const id of [...this.frames]) this._stopFrame(id); }

  _updateBloom() {
    const cp = this.camera.position, n = this.positions.length;
    if (!n) { for (const id of [...this.cards.keys()]) this._release(id); return; }
    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd);
    const tmp = new THREE.Vector3();
    const dists = [];
    for (let i = 0; i < n; i++) {
      tmp.subVectors(this.positions[i], cp);
      const d2 = tmp.lengthSq();
      if (tmp.dot(fwd) / Math.sqrt(d2 || 1) < 0.35) continue; // only stars in front of you bloom
      dists.push([d2, i]);
    }
    if (!dists.length) { for (const c of this.cards.values()) c.leaving = true; return; }
    dists.sort((a, b) => a[0] - b[0]);
    const want = new Set();
    const range2 = this.bloomRange * this.bloomRange;
    for (let k = 0; k < Math.min(this.K, dists.length); k++) if (dists[k][0] < range2) want.add(this.items[dists[k][1]].id);
    for (const id of [...this.cards.keys()]) if (!want.has(id)) { const c = this.cards.get(id); c.leaving = true; }
    for (const id of want) { const c = this._acquire(id); c.leaving = false; }
    // the closest card gets a live preview on touch devices (no hover there)
    if (this.mobile && dists[0][0] < 16) this._startFrame(this.items[dists[0][1]].id);
  }

  _updateCards(dt) {
    const now = performance.now();
    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd);
    for (const [id, card] of this.cards) {
      const p = this.positions[this.index.get(id)];
      if (!p) { this._release(id); continue; }
      const d = this.camera.position.distanceTo(p);
      const facing = p.clone().sub(this.camera.position).normalize().dot(fwd);
      if (facing < 0.2) card.leaving = true;
      card.obj.visible = facing > 0.05;
      const near = Math.min(1, Math.max(0, (d - 0.9) / 0.9));     // fade out if you fly right through it
      const target = card.leaving ? 0 : Math.min(1, Math.max(0, (this.bloomRange - d) / (this.bloomRange * 0.35))) * near;
      card.fade += (target - card.fade) * Math.min(1, dt * 6);
      if (card.leaving && card.fade < 0.02) { this._release(id); continue; }
      // float the card just above its star, facing the camera
      card.obj.position.copy(p).addScaledVector(this.camera.up, 0.2 + 0.62 * card.fade);
      card.obj.quaternion.copy(this.camera.quaternion);
      card.obj.scale.setScalar(CARD_SCALE * (0.55 + 0.45 * card.fade));
      card.el.style.opacity = card.fade.toFixed(3);
      // fresh frame every ~75s while bloomed
      if (now - card.refreshedAt > 75000 && !card.live) {
        card.refreshedAt = now;
        const pre = new Image();
        pre.onload = () => { if (card.id === id) card.img.src = pre.src; };
        pre.src = this.api.thumbUrl(id, { size: 'mq', bust: true }) + '&r=' + (now | 0);
      }
      if (card.live && now - card.frameStarted > 25000 && !card.el.classList.contains('hover')) this._stopFrame(id);
    }
  }

  // ---------- lifecycle ----------
  start() { if (this.running) return; this.running = true; this._last = performance.now(); requestAnimationFrame(this._loop); this.resize(); }
  stop() { this.running = false; this._setCardHover(null); this.stopAllFrames(); this.keys.clear(); this._setHover(-1); }

  resize() {
    const w = this.host.clientWidth || innerWidth, h = this.host.clientHeight || innerHeight;
    this.renderer.setSize(w, h); this.css.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.uniforms.px.value = this.renderer.getPixelRatio() * h / 900;
  }

  _keysMove(dt) {
    if (!this.keys.size) return;
    const f = new THREE.Vector3(); this.camera.getWorldDirection(f);
    const r = new THREE.Vector3().crossVectors(f, this.camera.up).normalize();
    const v = new THREE.Vector3();
    const k = this.keys;
    if (k.has('w') || k.has('arrowup')) v.add(f);
    if (k.has('s') || k.has('arrowdown')) v.sub(f);
    if (k.has('d') || k.has('arrowright')) v.add(r);
    if (k.has('a') || k.has('arrowleft')) v.sub(r);
    if (k.has('e')) v.y += 1;
    if (k.has('q')) v.y -= 1;
    if (!v.lengthSq()) return;
    const speed = (k.has('shift') ? 60 : 18) * dt;
    v.normalize().multiplyScalar(speed);
    this.camera.position.add(v); this.controls.target.add(v);
    this.flight = null; this.controls.autoRotate = false;
  }

  _loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, (now - this._last) / 1000); this._last = now;
    this.uniforms.time.value = (now - this._t0) / 1000;

    if (this.flight) {
      const f = this.flight, u = Math.min(1, (now - f.t0) / f.duration);
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      this.camera.position.lerpVectors(f.fromPos, f.toPos, e);
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
      this.camera.lookAt(this.controls.target);
      if (u >= 1) this.flight = null;
    } else {
      this._keysMove(dt);
      this.controls.update();
    }

    if (!this._bloomAt || now - this._bloomAt > 120) { this._updateBloom(); this._bloomAt = now; }
    this._updateCards(dt);
    if (this._pickPending && !this._pointer.down) {
      this._pickPending = false;
      const cid = this._cardAt(this._pointer.x, this._pointer.y);
      this._setCardHover(cid);
      this._setHover(cid ? -1 : this._pick(this._pointer.x, this._pointer.y));
      if (cid) this.renderer.domElement.style.cursor = 'pointer';
    }
    if (!this._lightAt || now - this._lightAt > 60000) { this.refreshLight(); this._lightAt = now; }

    this.renderer.render(this.scene, this.camera);
    this.css.render(this.cssScene, this.camera);
  }

  nearestIds(n = 9) {
    const cp = this.camera.position;
    return this.items.map((c, i) => [cp.distanceToSquared(this.positions[i]), c.id]).sort((a, b) => a[0] - b[0]).slice(0, n).map(x => x[1]);
  }

  dispose() {
    this.stop();
    removeEventListener('keydown', this._onKeyDown); removeEventListener('keyup', this._onKeyUp); removeEventListener('resize', this._onResize);
    for (const id of [...this.cards.keys()]) this._release(id);
    this.scene.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    this.renderer.dispose();
    this.host.innerHTML = '';
  }
}
