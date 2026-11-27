// review-cams: the reviewer's endpoint. Protected by the ADMIN_KEY secret (header `x-admin-key`).
// GET  ?status=pending|approved|rejected  → list submissions (private fields included, IP hash excluded)
// POST { id, action: 'approve'|'reject'|'pending', note?, edits? } → update status (and optional field edits)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const COLS = "id,created_at,video_id,name,place,country,lat,lon,tz,category,channel,channel_url,title,owner_attested,contact,note,check_embeddable,check_live,status,reviewed_at,review_note";
const EDITABLE = ["name", "place", "country", "lat", "lon", "tz", "category"];
const CATEGORIES = ["city", "nature", "wildlife", "beach", "port", "mountain", "rail", "aviation", "sky", "underwater"];

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const adminKey = Deno.env.get("ADMIN_KEY") || "";
  if (adminKey.length < 16) return json({ ok: false, error: "Review is not set up yet (ADMIN_KEY secret missing or too short)." }, 503);
  if (!safeEqual(req.headers.get("x-admin-key") || "", adminKey)) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return json({ ok: false, error: "Wrong admin key." }, 401);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  if (req.method === "GET") {
    const status = new URL(req.url).searchParams.get("status") || "pending";
    if (!["pending", "approved", "rejected"].includes(status)) return json({ ok: false, error: "Bad status" }, 400);
    const { data, error } = await db.from("cam_submissions").select(COLS).eq("status", status)
      .order(status === "pending" ? "created_at" : "reviewed_at", { ascending: status === "pending" }).limit(200);
    if (error) return json({ ok: false, error: error.message }, 500);
    const counts: Record<string, number> = {};
    for (const s of ["pending", "approved", "rejected"]) {
      const { count } = await db.from("cam_submissions").select("id", { count: "exact", head: true }).eq("status", s);
      counts[s] = count ?? 0;
    }
    return json({ ok: true, items: data, counts });
  }

  if (req.method === "POST") {
    let b: Record<string, unknown>;
    try { b = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
    const action = String(b.action || "");
    const map: Record<string, string> = { approve: "approved", reject: "rejected", pending: "pending" };
    if (!map[action] || typeof b.id !== "string") return json({ ok: false, error: "Bad request" }, 400);

    const patch: Record<string, unknown> = { status: map[action], reviewed_at: action === "pending" ? null : new Date().toISOString(), review_note: typeof b.note === "string" ? b.note.slice(0, 600) : null };
    const edits = (b.edits && typeof b.edits === "object") ? b.edits as Record<string, unknown> : {};
    for (const k of EDITABLE) {
      if (!(k in edits)) continue;
      const v = edits[k];
      if (k === "lat" || k === "lon") {
        const n = Number(v);
        if (!Number.isFinite(n) || Math.abs(n) > (k === "lat" ? 90 : 180)) return json({ ok: false, error: `Bad ${k}` }, 400);
        patch[k] = n;
      } else if (k === "category") {
        if (!CATEGORIES.includes(String(v))) return json({ ok: false, error: "Bad category" }, 400);
        patch[k] = String(v);
      } else patch[k] = String(v ?? "").trim().slice(0, k === "place" ? 120 : 80) || null;
    }

    // re-check embedding right before approving
    if (action === "approve") {
      const { data: row } = await db.from("cam_submissions").select("video_id").eq("id", b.id).maybeSingle();
      if (!row) return json({ ok: false, error: "Not found" }, 404);
      const oe = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + row.video_id)}`);
      if (oe.status === 401 || oe.status === 403) return json({ ok: false, error: "The owner has turned embedding off since it was submitted. Can’t approve." }, 422);
      if (!oe.ok) return json({ ok: false, error: "The video is no longer available on YouTube." }, 422);
    }

    const { data, error } = await db.from("cam_submissions").update(patch).eq("id", b.id).select(COLS).maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!data) return json({ ok: false, error: "Not found" }, 404);
    return json({ ok: true, item: data });
  }

  return json({ ok: false, error: "Method not allowed" }, 405);
});
