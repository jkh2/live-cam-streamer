# Now Here — "My Gallery" Starfield: Integration Spec (for Grok)

**The vision (James):** a person's saved live cams become **stars in space**. They fly from star to star. As they approach, a star **blooms into an animated thumbnail** of its live feed. Clicking a thumbnail plays that video in the main app. Every save adds a star, so someone with thousands of saved cams has a galaxy of thousands of stars.

**Repo:** https://github.com/jkh2/live-cam-streamer (branch `main`)

## 0. Where your work goes

| Path | Rule |
|---|---|
| `js/gallery-view.js` | **Replace.** Your entry point. Must `export function mountGallery(root, api)` |
| `css/gallery.css` | **Replace.** All your styles, scoped under `.nh-gallery` |
| `js/gallery/` | **New, optional.** Any extra modules you want (e.g. `js/gallery/starfield.js`, `js/gallery/layout.js`). Import them from `gallery-view.js` with relative paths like `./gallery/starfield.js` |
| `assets/gallery/` | **New, optional.** Small local assets (sprites, noise textures). Local files *can* be WebGL textures; only YouTube's images can't |
| everything else | **Don't edit.** Especially `index.html`, `js/main.js`, `js/store.js`, `js/globe.js`, `data/cams.json`. If you need something from the main app, ask James and Claude will add it to `api` |

Deliver it one of two ways:
1. **Pull request (preferred):** branch `grok/starfield-gallery` → PR into `main`, so Claude can review integration before it goes live.
2. **Files to James:** give him the complete files with their paths. He uploads them on GitHub (Add file → Upload files, into the right folders).

Done means: `python3 -m http.server` → open the app → ★ opens your galaxy → clicking a bloomed card closes it and plays that cam on the globe → ✕ / Esc returns to Earth with no console errors and no leftover iframes or animation loops.

**Your job:** build `js/gallery-view.js` (plus `css/gallery.css`). You don't build a video player; the main app already has one. Claude ships a basic placeholder at that path so the app works today. Your module **replaces that file**, and nothing else has to change, as long as you follow this contract.

---

## 1. Ground rules

- **Stack:** plain ES modules, no build step, no framework, no npm. Static hosting (GitHub Pages / Vercel).
- **Use the app's three.js. Don't bundle your own copy.** `index.html` already has this import map, so import from the same names:
  ```html
  <script type="importmap">{"imports":{
    "three":"https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js",
    "three/addons/":"https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/"}}</script>
  ```
  ```js
  import * as THREE from 'three';
  import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
  ```
  Two copies of three.js on one page causes subtle bugs.
- **No globals.** Export one function, `mountGallery` (section 3).
- **Storage goes through `js/store.js` only** (section 4). Never touch localStorage directly.
- **CSS:** scope everything under `.nh-gallery`, using the design tokens in section 8.
- **Live-only rule:** never show recorded or replay video. Never download, re-host, or screenshot frames. Hotlinking YouTube's own thumbnail URLs and using official embeds is fine.

## 2. ⚠️ Critical technical constraint: thumbnails can't be WebGL textures

`i.ytimg.com` does **not** send `Access-Control-Allow-Origin` (Claude checked the headers). Loading those images into a `THREE.Texture` **will fail**: browsers refuse cross-origin images in WebGL, so you get a security error or a black texture. A proxy isn't an option either, because that would be re-hosting their frames.

**So use a two-layer render:**

| Layer | Tech | What it draws |
|---|---|---|
| Back | `WebGLRenderer` | All N stars (one `THREE.Points` with a custom shader), nebula/dust, glow, flight lines |
| Front | `CSS3DRenderer` | Only the **nearest K bloomed thumbnails**, as real `<img>` / `<iframe>` DOM elements positioned in 3D |

Both renderers share **the same camera**. Stack the CSS3D `domElement` on top of the WebGL canvas (absolute, same size). Set `pointer-events: none` on the CSS3D root and `pointer-events: auto` on the tiles themselves, so dragging still flies the camera.

## 3. The function you export

```js
// js/gallery-view.js
export function mountGallery(root, api) {
  // root = <div id="gallery-root" class="nh-gallery">, a full-screen layer (position: fixed; inset: 0)
  return {
    setActive(isOpen) {},  // gallery opened (true) / closed (false)
    refresh() {},          // re-read api.gallery.list() and update the stars
    destroy() {},          // remove listeners, timers, iframes, dispose GPU resources
  };
}
```

- The main app calls `mountGallery()` **once** at startup. Create your renderers lazily on the first `setActive(true)`.
- **`setActive(true)`:** start your render loop. The main app **pauses its globe render** while the gallery is open, so the GPU is yours.
- **`setActive(false)`:** stop your `requestAnimationFrame` loop and all timers, and remove every preview `<iframe>`. A closed gallery must cost nothing.
- The main app owns the ✕ close button (top-right corner, roughly 64×64 px; keep that area clear) and the Esc key. Everything else on screen inside `root` is yours, including your own HUD.

`api` contains:

| Key | What it is |
|---|---|
| `api.gallery` | the store from `js/store.js` (section 4) |
| `api.openCam(cam)` | **call on thumbnail click**: closes the gallery, flies the globe to the cam, plays it in the main window |
| `api.thumbUrl(id, opts)` | live thumbnail URL (section 6) |
| `api.embedUrl(id, opts)` | muted YouTube embed URL (section 6) |
| `api.lightState(lat, lon)` | `{ key:'day'|'golden'|'twilight'|'night', label, icon, elevation }`, current sunlight at that cam |
| `api.localTime(tz)` | e.g. `"6:42 PM"` |
| `api.categories` | `{ city:{label,color}, wildlife:{…}, … }`, the same colors the globe uses |
| `api.openWall(ids)` | opens the multi-view watch wall (up to 9 ids) |
| `api.close()` | closes the gallery (if you want your own close control too) |
| `api.toast(msg)` | small notification |

## 4. Storage API (`js/store.js`, provided, don't modify)

```js
gallery.list()            // → Cam[] (newest first)
gallery.has(id) / add(cam) / remove(id) / toggle(cam)
gallery.reorder(ids)      // full ordered list of ids
gallery.clear()
gallery.exportJSON()      // → string (offer as a download: now-here-gallery.json)
gallery.importJSON(text)  // → number added (throws on a bad file)
gallery.onChange(fn)      // fn(items) on any change, including other tabs; returns unsubscribe
```

Saves happen elsewhere in the app (the ★ in the main window), so **subscribe with `onChange`**. When a cam is added while the gallery is open, **animate the new star being born**. That moment is the payoff of the whole concept.

### Cam object

```js
{
  id: "ydYDqZQpim8",        // YouTube video id (11 chars), the unique key
  source: "youtube",
  name: "Namib Desert Waterhole",
  place: "Namib Desert", country: "Namibia",
  lat: -24.75, lon: 15.28,
  tz: "Africa/Windhoek",    // may be missing on discovered cams
  category: "wildlife",     // city|nature|wildlife|beach|port|mountain|rail|aviation|sky|underwater|discovered
  channel: "NamibiaCam",    // stream owner: always credit them on the bloomed card
  channelUrl: "https://www.youtube.com/@NamibiaCam",
  title: "Namibia: Live stream in the Namib Desert",
  approx: true,             // optional: location estimated, show "≈"
  savedAt: "2026-11-27T06:30:00.000Z"
}
```

## 5. Star layout: must be stable

A star must stay **in the same place every visit**, so people learn their galaxy. Make position a **pure function of the cam**, never `Math.random()` at load time.

Suggested approach: a **spiral galaxy that grows outward with save order**. Star *i* (oldest = 0) sits on a log-spiral arm chosen by `category`, with radius ∝ √i. Jitter comes from a seeded hash of `id`, e.g. `mulberry32(hash(id))`. New saves land at the rim, and the galaxy visibly grows. The real `lat/lon` could also drive something, such as arm offset or height, so cams from one region cluster.

Star color = `api.categories[cam.category].color`. Star brightness or twinkle could reflect `api.lightState(...)`: daylight cams bright, golden-hour cams gold and pulsing, night cams dim blue.

## 6. Making thumbnails feel alive (the "bloom")

```js
api.thumbUrl(id)                       // https://i.ytimg.com/vi/<id>/hqdefault_live.jpg (480×360)
api.thumbUrl(id, { size: 'mq' })       // 320×180, 16:9: best for cards
api.thumbUrl(id, { size: 'maxres' })   // may 404 on some streams → fall back to 'hq'
api.thumbUrl(id, { bust: true })       // ?t=<minute>, fetches the latest frame
api.embedUrl(id, { controls: false })  // youtube-nocookie, autoplay=1&mute=1&playsinline=1
```

YouTube updates live thumbnails on its own servers. The image cache header is 5 minutes, so a fresh frame shows up every few minutes at most. Layer the animation, cheapest first:

1. **Bloom by distance.** Each frame, find the nearest **K ≈ 12–24** stars to the camera (use a spatial grid or octree, since a full scan of thousands every frame is fine up to about 5k, then grid it). Only those get a CSS3D card. Fade/scale cards in as distance drops; fade out and **recycle the DOM node** (pool them, don't create/destroy each frame).
2. **Breathing still.** Give the card image a slow CSS Ken Burns pan/zoom (8–14 s, alternate, random delay). It costs nothing and already reads as "alive".
3. **Fresh frames.** While a card is bloomed, re-request `thumbUrl(id,{size:'mq',bust:true})` every 60–90 s via an offscreen `Image()`, then crossfade. On `error`, keep the old frame.
4. **True motion for the closest 1–3.** When the camera is very close or hovering, swap the card's `<img>` for a muted `<iframe src=api.embedUrl(id,{controls:false})>`. **Hard cap: 3–4 iframes total.** Destroy them when out of range. YouTube iframes are heavy, and more will stall phones.

Don't use YouTube's hover "rich thumbnail" animated WebP. It isn't a stable public URL.

**Click:** on the card, call `api.openCam(cam)`. On a non-bloomed star, fly to it first, so the first click flies and the second opens.

## 7. Flight and scale

- Free-flight feel: drag to look/orbit, scroll or pinch to move forward, click a star to fly to it (eased), and optional WASD on desktop. A "Home" button returns to the galaxy overview.
- **Thousands of stars:** one `THREE.Points` draw call with a per-star attribute buffer handles 10k+ easily. Rebuild or extend the buffer in `refresh()`; don't make one Mesh per star.
- Empty state (0 saves): a single faint glowing seed with "Save a window from the globe (★) and it will become your first star."
- Search/filter within the galaxy (name, place, category) is a nice bonus. Fly to the match and light up its constellation.
- Header HUD idea: count of stars, plus **Watch Wall** (`api.openWall(list.slice(0,9).map(c=>c.id))`), **Export**, and **Import**.
- Phones: touch drag + pinch, K ≈ 8 cards, at most 2 iframes. Respect `prefers-reduced-motion`.

## 8. Design tokens (CSS variables on `:root`)

```css
--nh-bg:#02040b; --nh-glass:rgba(10,16,32,.62); --nh-glass-2:rgba(18,26,48,.78);
--nh-line:rgba(140,180,255,.16); --nh-text:#e8eefc; --nh-dim:#8b97b5;
--nh-accent:#6fd3ff; --nh-gold:#ffc56b; --nh-live:#ff4d5e; --nh-radius:14px;
--nh-font:"Space Grotesk",system-ui,sans-serif; --nh-mono:"JetBrains Mono",ui-monospace,monospace;
```

The globe uses deep navy space, additive glows, glass cards with hairline borders, and a pulsing red **LIVE** dot. Match that, and the gallery will feel like the same universe one zoom level out.

## 9. Quick test

Seed some stars from the browser console:

```js
const { gallery } = await import('./js/store.js');
gallery.add({ id:'ydYDqZQpim8', name:'Namib Desert Waterhole', place:'Namib Desert', country:'Namibia',
  lat:-24.75, lon:15.28, tz:'Africa/Windhoek', category:'wildlife', channel:'NamibiaCam',
  channelUrl:'https://www.youtube.com/@NamibiaCam' });
```

Or import a file of fake cams with `gallery.importJSON(...)` to stress-test thousands. Duplicate ids are skipped, and fake ids just show a grey placeholder thumbnail.

Run `python3 -m http.server` in the project folder and open `http://localhost:8000`. ES modules and `fetch` don't work from `file://`.
