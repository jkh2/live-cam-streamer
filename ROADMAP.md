# Sentinel Vantage: Roadmap
*by Sentinel AI Systems · started Thanksgiving 2026 · James, Claude & Grok*

## The rule (applies to every item below)
1. **Live video only.** No recordings, replays, or still-image cams.
2. **Only cameras published on purpose.** Each one comes from its owner's own channel, with embedding allowed by the owner. We never scan for devices or show unsecured, private, or "found" cameras.
3. **People stay in control.** Owners can turn a cam off by disabling embedding or ending the stream. Anyone can report a cam. Nothing community-submitted goes live without human review.

---

## ✅ Shipped (v1, Nov 26–27, 2026)
- Real-time 3D globe: live sun position, city lights, ocean glint, golden-hour band
- **146 verified live cams** on every continent except Antarctica, in 10 categories
- Fly-to windows tethered to the globe; local time, sun angle, nearby cams, save, share, report
- Follow the Sun / Wander / Surprise tours; search; place fly-to
- **My Galaxy:** saved cams as a flyable spiral starfield (concept: James & Grok; first build: Claude)
- Watch wall (up to 9 cams at once)
- **Community submissions** (Supabase): checked for real / embeddable / live, a review queue, and an admin review page
- Optional YouTube API key: live verification and live search across all of YouTube
- Nightly GitHub Action that re-verifies every cam (first run: 146/146 live)

---

## 🔧 Phase 1: Upkeep (small, protects what's live)
- [ ] **Reports go to the review queue**, not GitHub issues (most people don't have GitHub accounts). Add a `reports` table, a "report" action in `review.html`, and auto-hide a cam after N reports pending review.
- [ ] **Keep Supabase awake:** the nightly action touches the database so the free project never pauses.
- [ ] **New-submission notice:** a daily note to James when the review queue has items.
- [ ] **Community cams in the nightly refresh:** re-check approved submissions; hide dead ones.
- [ ] **Lite mode** for older phones (2D map fallback when WebGL is slow or missing).

## 🌍 Phase 2: A living globe
- [ ] **Live clouds:** NASA GIBS daily satellite cloud layer wrapped over the Earth.
- [ ] **Local weather in each window** (temperature, conditions, wind) from Open-Meteo.
- [ ] **ISS as a moving light** in real orbit, opening NASA's own live feed from the station.
- [ ] **Real night sky:** Moon in its actual phase and position; true star field.
- [ ] Ambient soundscapes per category (optional, off by default).

## 💛 Phase 3: Personal
- [ ] **Sunrise alerts:** "Your Venice cam is at sunrise in 10 minutes" (browser notifications).
- [ ] **Installable app (PWA):** home-screen icon, full-screen launch.
- [ ] **Postcards:** share a link that opens straight to a cam with its name and local time (text + link only, never captured frames).
- [ ] My Galaxy ideas for Grok: constellations people can name, region clustering, a warp transition into the globe, a spatial index past 10k stars. See `docs/GROK-HANDOFF.md`.

## 📡 Phase 4: Grow the catalog (ongoing, as many cams as we can find)
**Goal milestones:** 300 → 500 → 1,000 → 2,500 verified live cams.

**Fill the dark spots first:** Antarctica (research stations), Central Asia, Middle East & North Africa, West & Central Africa, Pacific islands, Canada's north, Greenland, Russia's far east, South America's interior, India & South Asia.

**Category depth:** more wildlife (seasonal: Katmai bears, hawk nests, sea turtle nests, migrations), more aurora/night-sky cams, volcano & weather cams, harbors and canals, mountain huts and ski areas, city squares in every capital.

**How cams get added:**
1. **Curated batches** (Claude + James): search per region and category, verify each stream is live and embeddable, place it accurately, set its time zone, and add it to `data/cams.json`.
2. **Community submissions** through ＋ Add your camera, reviewed in `review.html`.
3. **Discovery crawler (v2):** finds public web pages that embed live streams (via Common Crawl, never device scanning) and feeds a **review queue**. Nothing it finds goes live without approval. Rejects raw device URLs and default camera paths.

**Checklist for every new cam**
- [ ] Live right now, and embeddable (oEmbed OK)
- [ ] Published by the owner as a public camera (official channel, venue, city, park, business, or a hobbyist's own stream)
- [ ] No private homes or interiors, and no people filmed without consent (public streets and venues are fine)
- [ ] Accurate location (lat/lon to the spot), IANA time zone, category, owner credit
- [ ] Not a recording, a compilation "tour," or a re-stream of someone else's cams

## 🛡️ Phase 5: Trust & discovery
- [ ] **Verified-owner badge:** owner puts a short code in their stream description; the server confirms it via the YouTube API → ✓ badge.
- [ ] **Submission status link** for submitters ("pending / approved").
- [ ] Other platforms whose owners publish embeds on purpose (official city/DOT HLS feeds with CORS, park services, observatories).
- [ ] "Trending now" and seasonal event calendar (eclipses, launches, migrations).

---

## Notes for whoever picks this up next
- Static site, no build step: `python3 -m http.server` and open `localhost:8000`.
- Supabase project: `sentinel-vantage` (schema in `supabase/migrations`, functions in `supabase/functions`).
- Secrets: `ADMIN_KEY`, `YT_API_KEY` (Supabase); `YT_API_KEY` (GitHub Actions).
- Gallery contract: `docs/gallery-integration.md`.
