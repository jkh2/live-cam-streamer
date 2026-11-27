#!/usr/bin/env python3
"""
Nightly catalog refresher for Sentinel Vantage.

Uses the official YouTube Data API v3 (env var YT_API_KEY) to:
  1. check every cam in data/cams.json is still LIVE and EMBEDDABLE;
  2. for any cam that isn't, look for the same owner's current live stream with a
     matching title (24/7 streams sometimes restart under a new video id) and swap it in;
  3. otherwise mark the cam "offline" so the app hides it (it's re-checked the next night).

It never adds new cameras on its own. New cams go through human review (see README).
Quota: ~1 unit per 50 cams + 100 units per replacement search (default daily quota is 10,000).

Usage:  YT_API_KEY=... python3 tools/refresh_cams.py [--dry-run]
"""
import json, os, re, sys, urllib.parse, urllib.request
from datetime import datetime, timezone
from difflib import SequenceMatcher

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "data", "cams.json")
KEY = os.environ.get("YT_API_KEY")
MAX_SEARCHES = int(os.environ.get("MAX_SEARCHES", "40"))


def api(path, **params):
    params["key"] = KEY
    url = "https://www.googleapis.com/youtube/v3/" + path + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def status_of(ids):
    out = {}
    for i in range(0, len(ids), 50):
        chunk = ids[i:i + 50]
        j = api("videos", part="snippet,status", id=",".join(chunk), maxResults=50)
        for v in j.get("items", []):
            out[v["id"]] = {
                "live": v["snippet"].get("liveBroadcastContent") == "live",
                "embeddable": v["status"].get("embeddable", False),
                "channelId": v["snippet"]["channelId"],
                "title": v["snippet"]["title"],
            }
    return out


def channel_id_for(cam, known):
    if cam["id"] in known:
        return known[cam["id"]]["channelId"]
    m = re.search(r"/channel/(UC[\w-]+)", cam.get("channelUrl", ""))
    if m:
        return m.group(1)
    m = re.search(r"/@([\w.-]+)", cam.get("channelUrl", ""))
    if m:
        j = api("channels", part="id", forHandle="@" + m.group(1))
        if j.get("items"):
            return j["items"][0]["id"]
    return None


def find_replacement(cam, channel_id):
    j = api("search", part="snippet", channelId=channel_id, eventType="live", type="video",
            videoEmbeddable="true", maxResults=25)
    best, score = None, 0.0
    for it in j.get("items", []):
        s = SequenceMatcher(None, cam.get("title", cam["name"]).lower(), it["snippet"]["title"].lower()).ratio()
        if s > score:
            best, score = it, s
    if best and score >= 0.55:
        return best["id"]["videoId"], best["snippet"]["title"], score
    return None


def main():
    if not KEY:
        sys.exit("Set YT_API_KEY")
    dry = "--dry-run" in sys.argv
    doc = json.load(open(PATH, encoding="utf-8"))
    cams = doc["cams"]
    st = status_of([c["id"] for c in cams])
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    searches = ok = swapped = offline = 0
    for c in cams:
        s = st.get(c["id"])
        if s and s["live"] and s["embeddable"]:
            c.pop("offline", None)
            c["lastVerified"] = now
            ok += 1
            continue
        rep = None
        if searches < MAX_SEARCHES:
            cid = channel_id_for(c, st)
            if cid:
                searches += 1
                rep = find_replacement(c, cid)
        if rep:
            new_id, new_title, score = rep
            print(f"SWAP  {c['name']}: {c['id']} -> {new_id}  ({score:.2f}) {new_title}")
            c["previousIds"] = (c.get("previousIds") or [])[-4:] + [c["id"]]
            c["id"], c["title"], c["lastVerified"] = new_id, new_title, now
            c.pop("offline", None)
            swapped += 1
        else:
            print(f"OFF   {c['name']} ({c['id']})")
            c["offline"] = True
            offline += 1
    doc["generated"] = now
    print(f"\n{ok} live, {swapped} swapped, {offline} offline, {searches} searches")
    if not dry:
        json.dump(doc, open(PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
