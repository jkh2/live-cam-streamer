// submit-cam: public endpoint for "Add your camera".
// Checks the stream is a real, embeddable YouTube video (and live, when YT_API_KEY is set),
// rate-limits by hashed IP, and stores it as `pending` for human review. Never auto-publishes.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const CATEGORIES = ["city", "nature", "wildlife", "beach", "port", "mountain", "rail", "aviation", "sky", "underwater"];
const PER_IP_PER_HOUR = 5;
const MAX_PENDING = 500;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function videoIdFrom(input: string): string | null {
  const s = String(input || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return u.pathname.slice(1, 12) || null;
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const v = u.searchParams.get("v");
      if (v) return v.slice(0, 11);
      const m = u.pathname.match(/\/(?:live|embed|shorts|v)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch { /* not a URL */ }
  return null;
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid request" }, 400); }

  // honeypot: real people never fill this hidden field
  if (clean(body.website, 50)) return json({ ok: true, status: "pending" });

  const videoId = videoIdFrom(String(body.url ?? body.video_id ?? ""));
  const name = clean(body.name, 80), place = clean(body.place, 120), country = clean(body.country, 80);
  const tz = clean(body.tz, 64), category = clean(body.category, 20);
  const contact = clean(body.contact, 200), note = clean(body.note, 600);
  const lat = Number(body.lat), lon = Number(body.lon);

  if (!videoId) return json({ ok: false, error: "That doesn’t look like a YouTube video or live-stream link." }, 400);
  if (name.length < 2) return json({ ok: false, error: "Please give the camera a name." }, 400);
  if (place.length < 2 || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return json({ ok: false, error: "Please choose where the camera is." }, 400);
  if (!CATEGORIES.includes(category)) return json({ ok: false, error: "Please pick what the camera shows." }, 400);
  if (body.owner_attested !== true || body.public_ok !== true)
    return json({ ok: false, error: "Please confirm both statements about the stream." }, 400);

  // 1) Does the video exist, and does its owner allow embedding? (oEmbed: 401 = embedding off, 404 = missing)
  const oe = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + videoId)}`);
  if (oe.status === 401 || oe.status === 403)
    return json({ ok: false, error: "This stream’s owner doesn’t allow it to be shown on other sites (embedding is off in YouTube settings)." }, 422);
  if (!oe.ok) return json({ ok: false, error: "We couldn’t find that video on YouTube. Is the link public?" }, 422);
  const meta = await oe.json();

  // 2) Is it live right now? (only when a YouTube Data API key is configured)
  let checkLive: boolean | null = null;
  const ytKey = Deno.env.get("YT_API_KEY");
  if (ytKey) {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=${videoId}&key=${ytKey}`);
    if (r.ok) {
      const v = (await r.json()).items?.[0];
      checkLive = v?.snippet?.liveBroadcastContent === "live";
      if (!checkLive) return json({ ok: false, error: "That video isn’t live right now. Now Here only shows live streams. Submit it while it’s streaming." }, 422);
    }
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // 3) rate limit by hashed IP (the raw IP is never stored)
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const ipHash = await sha256(ip + "|" + (Deno.env.get("SUBMIT_SALT") || Deno.env.get("SUPABASE_URL")));
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count: recent } = await db.from("cam_submissions").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", hourAgo);
  if ((recent ?? 0) >= PER_IP_PER_HOUR) return json({ ok: false, error: "Thanks! That’s a lot of cameras for one hour. Please try again later." }, 429);
  const { count: pending } = await db.from("cam_submissions").select("id", { count: "exact", head: true }).eq("status", "pending");
  if ((pending ?? 0) >= MAX_PENDING) return json({ ok: false, error: "The review queue is full right now. Please try again in a few days." }, 503);

  // 4) already submitted?
  const { data: existing } = await db.from("cam_submissions").select("status").eq("video_id", videoId).neq("status", "rejected").maybeSingle();
  if (existing) return json({ ok: false, duplicate: true, error: existing.status === "approved" ? "This camera is already on the globe." : "This camera is already waiting for review." }, 409);

  const { error } = await db.from("cam_submissions").insert({
    video_id: videoId, name, place, country: country || null, lat, lon, tz: tz || null, category,
    channel: clean(meta.author_name, 120) || null, channel_url: clean(meta.author_url, 300) || null, title: clean(meta.title, 300) || null,
    owner_attested: true, contact: contact || null, note: note || null, ip_hash: ipHash,
    check_embeddable: true, check_live: checkLive, status: "pending",
  });
  if (error) return json({ ok: false, error: "Something went wrong saving your camera. Please try again." }, 500);

  return json({ ok: true, status: "pending", title: meta.title, channel: meta.author_name });
});
