# Now Here · live windows on Earth

A real-time 3D globe of **live video cameras that their owners chose to share with the world**. The sunlight on the globe is calculated for this exact moment, so you can watch night fall across continents, see city lights come on, and catch the sunrise wherever it's happening right now.

**Live:** `https://jkh2.github.io/live-cam-streamer/` (once Pages is enabled)

## What it does
- **Living Earth:** NASA day and night imagery blended by the real sun position, ocean sun-glint, golden-hour band, atmosphere.
- **146 hand-checked live cams** across every continent except Antarctica: cities, wildlife, beaches, harbors, mountains, rail, airports, aurora, underwater.
- **Fly-to windows:** click a light; the camera flies there and a window opens, tethered to its spot on the globe. Each window shows local time, sun angle, nearby cams, save, share, report.
- **Follow the sun:** an automatic tour of cams at sunrise or sunset right now. **Wander** and **Surprise me** for random travel.
- **Search:** cams by name, place, or type; fly to any place on Earth (OpenStreetMap) and see the nearest windows.
- **My Gallery:** save cams (★); they're kept in your browser, with export and import. The gallery view is a pluggable module (see `docs/gallery-integration.md`).
- **Watch wall:** up to 9 saved cams at once.
- **Optional YouTube API key (BYOK):** verifies which cams are live right now and unlocks **live search of all of YouTube Live** for any place (live + embeddable streams only).

## The rule
1. **Live video only.** No recordings, replays, or still-image cams.
2. **Only cameras published on purpose.** Every stream comes from its owner's public channel, with embedding allowed by the owner. We never scan the internet for cameras or show unsecured/private devices.
3. **Owners stay in control.** If an owner disables embedding or ends a stream, it disappears. Anyone can report a camera with ⚑.

## Run locally
```
python3 -m http.server 8000     # then open http://localhost:8000
```
No build step. three.js loads from jsDelivr via an import map.

## Files
```
index.html            app shell
css/style.css         UI
css/gallery.css       gallery view styles (replaceable)
js/main.js            app logic: search, window, tours, wall, settings
js/globe.js           three.js globe, shaders, beacons, fly-to
js/sun.js             solar position math
js/store.js           My Gallery storage API
js/gallery-view.js    gallery view (replaceable module)
js/youtube.js         embeds, live thumbnails, optional API calls
js/sound.js           synthesized UI sounds
data/cams.json        the camera catalog
tools/refresh_cams.py nightly verifier (YouTube Data API)
.github/workflows/    nightly refresh action
docs/                 integration notes
```

## Keeping the catalog fresh
Add a repo secret `YT_API_KEY` (a YouTube Data API v3 key). The **Refresh live cams** action runs nightly. It checks each cam is live and embeddable, swaps in the owner's restarted stream when a 24/7 feed changes ids, and marks dead cams `offline` so the app hides them.

## Community submissions (Supabase)
Anyone can submit a live stream they own with **＋ Add your camera**. Nothing is published automatically:
1. The `submit-cam` Edge Function checks the link is a real YouTube video whose owner allows embedding (and that it's live, if a `YT_API_KEY` secret is set). It rate-limits by hashed IP, then stores it as **pending**.
2. You review at **`/review.html`** (protected by the `ADMIN_KEY` secret): preview the stream, check the location, fix the name, place or time zone, then **Approve** or **Reject**. Approval re-checks embedding first.
3. Approved cams load onto everyone's globe with a COMMUNITY tag.

The table allows **no direct writes** from browsers. The public can read only approved cams, and only their public columns. Contact info, notes and IP hashes are never exposed.

Setup: run `supabase/migrations/001_cam_submissions.sql`, deploy `supabase/functions/submit-cam` and `review-cams` (JWT verification off; they do their own checks), set the `ADMIN_KEY` secret (and optionally `YT_API_KEY`), then fill `supabaseUrl` and `supabaseKey` (publishable key) in `js/config.js`.

## Adding cams
Edit `data/cams.json`. Every cam needs: `id` (YouTube video id), `name`, `place`, `country`, `lat`, `lon`, `tz`, `category`, `channel`, `channelUrl`, `title`. Only add streams that are live, embeddable, and clearly published by their owner as a public camera.

Planned v2: a discovery crawler that searches public web pages for embedded live streams and feeds a **human review queue**. Nothing it finds goes live without approval.
