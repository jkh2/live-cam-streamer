# Handoff to Grok: "My Galaxy" first build

Hey Grok. While you were resting, James asked me to keep going, so I built a first version of your starfield gallery. It's your concept. Treat this as a starting point you're free to rework or replace. The contract in `docs/gallery-integration.md` hasn't changed.

## What's here
- `js/gallery-view.js`: entry point (`mountGallery`), HUD, search, focus bar, export/import, empty state.
- `js/gallery/galaxy.js`: the scene (`Galaxy` class).
- `css/gallery.css`: all styles, scoped under `.nh-gallery`.

## How it works
- **Layout:** a 4-arm log-spiral. Star *i* (oldest first, by `savedAt`) sits at radius `3.5 + 3.1·√(i+1)` on the arm for its category, with seeded jitter from a hash of its id. So every star is stable, and new saves land at the rim. A procedural dust and nebula disk scales with the galaxy, so even 1 to 10 stars sit somewhere beautiful.
- **Stars:** one `THREE.Points` draw call (custom shader). Color = category, dimmed and blue-shifted at night. Golden-hour cams pulse gold. Every star has a minimum pixel size so it never vanishes in the overview. New saves get a birth flash, and the camera flies to the new star.
- **Bloom:** every 120 ms, the nearest **K** stars *in front of* the camera (12 desktop / 8 phone, within 13 units) get a pooled CSS3D card: live thumbnail with a Ken Burns drift, LIVE dot, sun-state icon, local time, and owner credit. Thumbnails refresh about every 75 s.
- **Live preview:** hovering a card for 0.65 s swaps the still for a muted embed (cap 3 desktop / 1 phone). On phones, the closest card previews automatically. Previews retire after 25 s, or immediately on close.
- **Gotcha I hit:** browsers don't reliably register clicks on CSS3D elements (clicks fell through to the canvas). So cards have `pointer-events:none`, and `Galaxy._cardAt()` projects each card's four corners to the screen and tests the point itself. Hover and click both go through it.
- **Interaction:** drag/scroll (OrbitControls), WASD + Q/E to drift (Shift = faster), click a star to fly there, click a card to play it on the globe. The focus bar (Watch / Remove with confirm) replaced in-card buttons for the same click reason. In-galaxy search highlights matches; Enter cycles through them.
- **Lifecycle:** `setActive(false)` stops the render loop, removes all iframes, clears keys and hover. Tested with 0, 25, 60 (phone) and 3,000 stars: no leftover iframes or loops after closing.

## Ideas I didn't get to (yours to take)
- Constellation threads between related stars. I tried linking consecutive saves per arm; it read as scribbles, so it's disabled (`if (false)` in `setItems`).
- Lat/lon influence on layout (cams from one region clustering), or a "Daylight / Golden / Night" color mode.
- A smoother "warp" transition when a card is clicked (currently the gallery fades and the globe flies).
- Spatial grid for bloom selection past ~10k stars (it's a full sort today, fine at 3k).

Claude
