import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { subsolarPoint } from './sun.js';
import { CONFIG } from './config.js';

export const R = 1;
const BEACON_R = 1.004;
const PILLAR_TOP = 1.055;

export function latLonToVec3(lat, lon, r = R, out = new THREE.Vector3()) {
  const phi = (lon + 180) * Math.PI / 180;
  const theta = (90 - lat) * Math.PI / 180;
  return out.set(-r * Math.sin(theta) * Math.cos(phi), r * Math.cos(theta), r * Math.sin(theta) * Math.sin(phi));
}

export function vec3ToLatLon(v) {
  const n = v.clone().normalize();
  const lat = 90 - Math.acos(n.y) * 180 / Math.PI;
  let lon = Math.atan2(n.z, -n.x) * 180 / Math.PI - 180;
  lon = ((lon + 540) % 360) - 180;
  return { lat, lon };
}

const earthVert = /* glsl */`
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  void main(){
    vUv = uv;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vP = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const earthFrag = /* glsl */`
  uniform sampler2D dayMap; uniform sampler2D nightMap; uniform sampler2D waterMap;
  uniform vec3 sunDir; uniform float ready;
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  void main(){
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vP);
    float d = dot(N, sunDir);
    float dayMix = smoothstep(-0.10, 0.22, d);
    vec3 day = texture2D(dayMap, vUv).rgb;
    vec3 nightC = texture2D(nightMap, vUv).rgb;
    float water = texture2D(waterMap, vUv).r;

    vec3 lit = day * (0.05 + 1.15 * max(d, 0.0));
    vec3 lights = pow(nightC, vec3(1.5)) * vec3(1.7, 1.25, 0.8) * 2.4 + day * 0.018;
    vec3 col = mix(lights, lit, dayMix);

    // warm band along the terminator (golden hour on Earth, right now)
    float tw = exp(-pow((d + 0.01) / 0.045, 2.0));
    float land = 1.0 - water * 0.6;
    col += vec3(1.0, 0.45, 0.16) * tw * 0.07 * land + day * tw * vec3(0.9, 0.45, 0.2) * 0.35;

    // sun glint on oceans
    vec3 H = normalize(sunDir + V);
    float spec = pow(max(dot(N, H), 0.0), 55.0) * water * smoothstep(-0.05, 0.3, d);
    col += vec3(1.0, 0.85, 0.6) * spec * 0.95;

    // atmospheric rim on the lit side
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    col += vec3(0.30, 0.58, 1.0) * fres * 0.45 * smoothstep(-0.35, 0.4, d);

    col = mix(vec3(0.02, 0.03, 0.06), col, ready);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const atmoVert = /* glsl */`
  varying vec3 vNv; varying vec3 vNw;
  void main(){
    vNv = normalize(normalMatrix * normal);
    vNw = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const atmoFrag = /* glsl */`
  uniform vec3 sunDir;
  varying vec3 vNv; varying vec3 vNw;
  void main(){
    float k = clamp(-vNv.z, 0.0, 1.0);
    float glow = pow(k, 3.2);
    float s = dot(normalize(vNw), sunDir);
    vec3 dayC = vec3(0.32, 0.62, 1.0);
    vec3 duskC = vec3(1.0, 0.45, 0.18);
    vec3 nightC = vec3(0.10, 0.16, 0.42);
    vec3 c = mix(nightC, dayC, smoothstep(-0.2, 0.35, s));
    c = mix(c, duskC, exp(-pow(s / 0.16, 2.0)) * 0.75);
    float a = glow * (0.35 + 0.9 * smoothstep(-0.4, 0.3, s));
    gl_FragColor = vec4(c * a * 1.25, a);
  }`;

const beaconVert = /* glsl */`
  attribute vec3 color; attribute float phase; attribute float vis; attribute float hl; attribute float golden;
  uniform float time; uniform float px;
  varying vec3 vColor; varying float vAlpha; varying float vHl;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec3 N = normalize(wp.xyz);
    vec3 toCam = normalize(cameraPosition - wp.xyz);
    float front = smoothstep(-0.02, 0.18, dot(N, toCam));
    float pulse = 0.78 + 0.22 * sin(time * (2.0 + golden * 1.5) + phase);
    vec4 mv = viewMatrix * wp;
    float size = (1.0 + golden * 0.45 + hl * 1.1) * pulse;
    gl_PointSize = size * px * 26.0 / max(-mv.z, 0.2);
    vColor = mix(color, vec3(1.0, 0.82, 0.45), golden * 0.55);
    vAlpha = front * vis;
    vHl = hl;
    gl_Position = projectionMatrix * mv;
  }`;

const beaconFrag = /* glsl */`
  varying vec3 vColor; varying float vAlpha; varying float vHl;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float halo = exp(-r * r * 22.0);
    float core = smoothstep(0.09, 0.0, r);
    float ring = vHl * smoothstep(0.03, 0.0, abs(r - 0.36)) * 0.9;
    vec3 col = vColor * halo * 1.15 + vec3(1.0) * (core + ring);
    gl_FragColor = vec4(col, (halo * 0.9 + core + ring) * vAlpha);
  }`;

const pillarVert = /* glsl */`
  attribute vec3 color; attribute float t; attribute float vis;
  varying vec3 vColor; varying float vA;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec3 N = normalize(wp.xyz);
    float front = smoothstep(-0.02, 0.2, dot(N, normalize(cameraPosition - wp.xyz)));
    vColor = color; vA = (1.0 - t) * front * vis;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const pillarFrag = /* glsl */`
  varying vec3 vColor; varying float vA;
  void main(){ gl_FragColor = vec4(vColor * vA, vA * 0.9); }`;

export class Globe {
  constructor(container, { onHover, onSelect, onFrame, onInteract } = {}) {
    this.container = container;
    this.onHover = onHover || (() => {});
    this.onSelect = onSelect || (() => {});
    this.onFrame = onFrame || (() => {});
    this.onInteract = onInteract || (() => {});
    this.cams = [];
    this.hoverIndex = -1;
    this.selectedIndex = -1;
    this.offset = { x: 0, y: 0, tx: 0, ty: 0 };
    this.flight = null;
    this._t0 = performance.now();
    this._tmp = new THREE.Vector3();

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.setSize(container.clientWidth, container.clientHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x01020a);
    this.camera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight, 0.01, 200);
    this.camera.position.set(0, 0, 9);

    const c = this.controls = new OrbitControls(this.camera, r.domElement);
    c.enableDamping = true; c.dampingFactor = 0.06;
    c.enablePan = false; c.rotateSpeed = 0.42; c.zoomSpeed = 0.7;
    c.minDistance = 1.22; c.maxDistance = 7;
    c.autoRotate = true; c.autoRotateSpeed = 0.22;
    c.addEventListener('start', () => { this.flight = null; this.onInteract(); });

    this.sunDir = new THREE.Vector3(1, 0, 0);
    this._buildStars();
    this._buildEarth();
    this._buildRings();
    this.updateSun();

    this._pointer = { x: -9999, y: -9999, downX: 0, downY: 0, down: false };
    const el = r.domElement;
    el.addEventListener('pointermove', e => this._onMove(e));
    el.addEventListener('pointerdown', e => { this._pointer.down = true; this._pointer.downX = e.clientX; this._pointer.downY = e.clientY; });
    el.addEventListener('pointerup', e => this._onUp(e));
    el.addEventListener('pointerleave', () => { this._pointer.x = -9999; this._setHover(-1); });
    window.addEventListener('resize', () => this.resize());

    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _buildStars() {
    const loader = new THREE.TextureLoader();
    const sky = loader.load(CONFIG.textures + 'night-sky.png');
    sky.colorSpace = THREE.SRGBColorSpace;
    const skyMesh = new THREE.Mesh(
      new THREE.SphereGeometry(90, 48, 32),
      new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, color: 0x5a6070, depthWrite: false })
    );
    this.scene.add(skyMesh);

    const n = 5000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 20);
      pos.set([v.x, v.y, v.z], i * 3);
      const t = Math.random();
      const cc = t < 0.15 ? [1, 0.82, 0.68] : t < 0.3 ? [0.7, 0.82, 1] : [1, 1, 1];
      const b = 0.35 + Math.random() * 0.65;
      col.set([cc[0] * b, cc[1] * b, cc[2] * b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true }));
    this.scene.add(this.stars);
  }

  _buildEarth() {
    const loader = new THREE.TextureLoader();
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    let loaded = 0;
    const done = () => { if (++loaded === 3) this._texturesReady = performance.now(); };
    const tex = (name, srgb) => {
      const t = loader.load(CONFIG.textures + name, done, undefined, done);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = aniso;
      return t;
    };
    this.earthUniforms = {
      dayMap: { value: tex('earth-blue-marble.jpg', true) },
      nightMap: { value: tex('earth-night.jpg', true) },
      waterMap: { value: tex('earth-water.png', false) },
      sunDir: { value: this.sunDir },
      ready: { value: 0 },
    };
    this.earth = new THREE.Mesh(
      new THREE.SphereGeometry(R, 128, 96),
      new THREE.ShaderMaterial({ uniforms: this.earthUniforms, vertexShader: earthVert, fragmentShader: earthFrag })
    );
    this.scene.add(this.earth);

    this.atmo = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.13, 96, 64),
      new THREE.ShaderMaterial({
        uniforms: { sunDir: { value: this.sunDir } },
        vertexShader: atmoVert, fragmentShader: atmoFrag,
        side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      })
    );
    this.scene.add(this.atmo);
  }

  _buildRings() {
    this.rings = [];
    const grp = this.ringGroup = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.92, 1, 64),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      m.userData.phase = i / 3;
      grp.add(m); this.rings.push(m);
    }
    grp.visible = false;
    this.scene.add(grp);
  }

  /** cams: array of { lat, lon, color:[r,g,b], visible, golden } */
  setCams(cams) {
    this.cams = cams;
    if (this.beacons) { this.scene.remove(this.beacons, this.pillars); this.beacons.geometry.dispose(); this.pillars.geometry.dispose(); }
    const n = cams.length;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), phase = new Float32Array(n),
      vis = new Float32Array(n), hl = new Float32Array(n), golden = new Float32Array(n);
    const ppos = new Float32Array(n * 6), pcol = new Float32Array(n * 6), pt = new Float32Array(n * 2), pvis = new Float32Array(n * 2);
    const v = new THREE.Vector3(), v2 = new THREE.Vector3();
    cams.forEach((c, i) => {
      latLonToVec3(c.lat, c.lon, BEACON_R, v);
      latLonToVec3(c.lat, c.lon, PILLAR_TOP, v2);
      c._world = latLonToVec3(c.lat, c.lon, BEACON_R);
      pos.set([v.x, v.y, v.z], i * 3);
      col.set(c.color, i * 3);
      phase[i] = Math.random() * Math.PI * 2;
      vis[i] = c.visible === false ? 0 : 1;
      golden[i] = c.golden ? 1 : 0;
      ppos.set([v.x, v.y, v.z, v2.x, v2.y, v2.z], i * 6);
      pcol.set([...c.color, ...c.color], i * 6);
      pt.set([0, 1], i * 2);
      pvis.set([vis[i], vis[i]], i * 2);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('vis', new THREE.BufferAttribute(vis, 1));
    g.setAttribute('hl', new THREE.BufferAttribute(hl, 1));
    g.setAttribute('golden', new THREE.BufferAttribute(golden, 1));
    this.beaconUniforms = { time: { value: 0 }, px: { value: this.renderer.getPixelRatio() * this.container.clientHeight / 900 } };
    this.beacons = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.beaconUniforms, vertexShader: beaconVert, fragmentShader: beaconFrag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.beacons.renderOrder = 3;

    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(pcol, 3));
    pg.setAttribute('t', new THREE.BufferAttribute(pt, 1));
    pg.setAttribute('vis', new THREE.BufferAttribute(pvis, 1));
    this.pillars = new THREE.LineSegments(pg, new THREE.ShaderMaterial({
      vertexShader: pillarVert, fragmentShader: pillarFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.pillars.renderOrder = 2;
    this.scene.add(this.pillars, this.beacons);
    this._refreshHighlights();
  }

  /** Update per-cam visibility / golden flags without rebuilding. */
  refreshFlags() {
    if (!this.beacons) return;
    const vis = this.beacons.geometry.attributes.vis, golden = this.beacons.geometry.attributes.golden, pvis = this.pillars.geometry.attributes.vis;
    this.cams.forEach((c, i) => {
      const v = c.visible === false ? 0 : 1;
      vis.array[i] = v; pvis.array[i * 2] = v; pvis.array[i * 2 + 1] = v;
      golden.array[i] = c.golden ? 1 : 0;
    });
    vis.needsUpdate = golden.needsUpdate = pvis.needsUpdate = true;
  }

  _refreshHighlights() {
    if (!this.beacons) return;
    const hl = this.beacons.geometry.attributes.hl;
    hl.array.fill(0);
    if (this.hoverIndex >= 0) hl.array[this.hoverIndex] = 0.6;
    if (this.selectedIndex >= 0) hl.array[this.selectedIndex] = 1;
    hl.needsUpdate = true;
  }

  updateSun(date = new Date()) {
    const s = subsolarPoint(date);
    this.subsolar = s;
    latLonToVec3(s.lat, s.lon, 1, this.sunDir).normalize();
  }

  setSelected(index) {
    this.selectedIndex = index;
    this._refreshHighlights();
    const c = this.cams[index];
    if (c) {
      const p = latLonToVec3(c.lat, c.lon, 1.002);
      this.ringGroup.position.copy(p);
      this.ringGroup.lookAt(p.clone().multiplyScalar(2));
      this.ringGroup.visible = true;
      this.rings.forEach(m => m.material.color.setRGB(...c.color));
    } else this.ringGroup.visible = false;
  }

  /** Screen position (CSS px) of a cam, plus whether it faces the camera. */
  screenOf(index) {
    const c = this.cams[index];
    if (!c) return null;
    return this.project(c._world);
  }

  project(world) {
    const v = this._tmp.copy(world).project(this.camera);
    const toCam = this.camera.position.clone().sub(world).normalize();
    const facing = world.clone().normalize().dot(toCam);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: (v.x + 1) / 2 * rect.width + rect.left, y: (1 - v.y) / 2 * rect.height + rect.top, facing };
  }

  _pick(x, y) {
    let best = -1, bestD = 18 * 18;
    for (let i = 0; i < this.cams.length; i++) {
      const c = this.cams[i];
      if (c.visible === false) continue;
      const s = this.project(c._world);
      if (s.facing < 0.12) continue;
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  _onMove(e) {
    this._pointer.x = e.clientX; this._pointer.y = e.clientY;
    if (this._pointer.down) return;
    this._setHover(this._pick(e.clientX, e.clientY));
  }

  _setHover(i) {
    if (i === this.hoverIndex) return;
    this.hoverIndex = i;
    this.renderer.domElement.style.cursor = i >= 0 ? 'pointer' : 'grab';
    this._refreshHighlights();
    this.onHover(i, this._pointer);
  }

  _onUp(e) {
    const p = this._pointer;
    p.down = false;
    if (Math.hypot(e.clientX - p.downX, e.clientY - p.downY) > 6) return;
    const i = this._pick(e.clientX, e.clientY);
    if (i >= 0) this.onSelect(i);
  }

  /** Smoothly fly the camera to look down on lat/lon from a given distance. */
  flyTo(lat, lon, dist = 1.85, duration = 2400) {
    const from = this.camera.position.clone();
    const fromLen = from.length();
    const toDir = latLonToVec3(lat, lon, 1).normalize();
    // nudge slightly south so the cam sits a touch above center (horizon reads better)
    const fromDir = from.clone().normalize();
    const angle = fromDir.angleTo(toDir);
    const q0 = new THREE.Quaternion();
    const q1 = new THREE.Quaternion().setFromUnitVectors(fromDir, toDir);
    this.controls.autoRotate = false;
    this.flight = {
      t0: performance.now(), duration: Math.max(1200, Math.min(duration, 1200 + angle * 1100)),
      fromDir, q0, q1, fromLen, toLen: dist, lift: Math.min(1.4, angle * 0.55),
    };
  }

  zoomTo(dist, duration = 1600) {
    const dir = this.camera.position.clone().normalize();
    const ll = vec3ToLatLon(dir);
    this.flyTo(ll.lat, ll.lon, dist, duration);
  }

  setAutoRotate(on) { this.controls.autoRotate = on; }

  /** Shift the rendered globe so it stays centered in the area not covered by a panel. */
  setViewShift(x, y) { this.offset.tx = x; this.offset.ty = y; }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this._applyOffset(true);
    if (this.beaconUniforms) this.beaconUniforms.px.value = this.renderer.getPixelRatio() * h / 900;
  }

  _applyOffset(force) {
    const o = this.offset;
    const nx = o.x + (o.tx - o.x) * 0.08, ny = o.y + (o.ty - o.y) * 0.08;
    if (!force && Math.abs(nx - o.x) < 0.05 && Math.abs(ny - o.y) < 0.05 && o.x === o.tx && o.y === o.ty) return;
    o.x = Math.abs(o.tx - nx) < 0.3 ? o.tx : nx;
    o.y = Math.abs(o.ty - ny) < 0.3 ? o.ty : ny;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (Math.abs(o.x) < 0.01 && Math.abs(o.y) < 0.01) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, o.x, o.y, w, h);
    this.camera.updateProjectionMatrix();
  }

  _loop(now) {
    requestAnimationFrame(this._loop);
    if (this.paused) return;
    const t = (now - this._t0) / 1000;

    if (this._texturesReady) {
      const k = Math.min(1, (performance.now() - this._texturesReady) / 1400);
      this.earthUniforms.ready.value = k * k * (3 - 2 * k);
    }
    if (this.beaconUniforms) this.beaconUniforms.time.value = t;
    if (!this._lastSun || now - this._lastSun > 5000) { this.updateSun(); this._lastSun = now; }

    if (this.flight) {
      const f = this.flight;
      const u = Math.min(1, (now - f.t0) / f.duration);
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      const q = f.q0.clone().slerp(f.q1, e);
      const dir = f.fromDir.clone().applyQuaternion(q);
      const len = f.fromLen + (f.toLen - f.fromLen) * e + Math.sin(Math.PI * e) * f.lift;
      this.camera.position.copy(dir.multiplyScalar(len));
      this.camera.lookAt(0, 0, 0);
      if (u >= 1) this.flight = null;
    } else {
      this.controls.update();
    }

    // dim stars slightly while zoomed in
    const dist = this.camera.position.length();
    this.stars.material.opacity = 0.35 + 0.55 * Math.min(1, (dist - 1.2) / 2.5);
    this.controls.rotateSpeed = 0.12 + 0.32 * Math.min(1, (dist - 1.2) / 2.2);

    if (this.ringGroup.visible) {
      const base = 0.012 + 0.03 * Math.min(1, (dist - 1.1) / 2);
      this.rings.forEach(m => {
        const p = (t * 0.55 + m.userData.phase) % 1;
        const s = base * (0.4 + p * 2.6);
        m.scale.setScalar(s);
        m.material.opacity = (1 - p) * 0.7;
      });
    }

    this._applyOffset(false);
    this.renderer.render(this.scene, this.camera);
    this.onFrame(t);
  }
}
