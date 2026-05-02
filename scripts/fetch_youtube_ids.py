#!/usr/bin/env python3
"""
Search YouTube for each song in soundtracks.json and persist video IDs to
data/youtube_ids.json. Resumable: skips songs already mapped.

Usage:  python3 scripts/fetch_youtube_ids.py
"""
import json
import os
import re
import sys
import time
import unicodedata
import warnings

warnings.filterwarnings("ignore")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SONGS_JSON = os.path.join(ROOT, "data", "soundtracks.json")
OUT_JSON = os.path.join(ROOT, "data", "youtube_ids.json")
LOG_PATH = os.path.join(ROOT, "data", "youtube_ids.log")
SAVE_EVERY = 25
SLEEP_BETWEEN = 0.4


def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s


def fifa_slug(edition):
    e = edition.lower().replace("ea sports fc ", "fc").replace("fifa ", "fifa")
    return e.replace(" ", "")


def build_song_list():
    with open(SONGS_JSON, encoding="utf-8") as f:
        data = json.load(f)
    out = []
    seen = set()
    for edition, tracks in data.items():
        fslug = fifa_slug(edition)
        for t in tracks:
            base = f"{fslug}-{slugify(t['artist'])}-{slugify(t['title'])}"[:120]
            sid, n = base, 2
            while sid in seen:
                sid = f"{base}-{n}"
                n += 1
            seen.add(sid)
            out.append((sid, t["title"], t["artist"]))
    return out


def load_existing():
    if os.path.exists(OUT_JSON):
        with open(OUT_JSON, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save(mapping):
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(mapping, f, indent=2, ensure_ascii=False)


def log(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def main():
    import yt_dlp

    songs = build_song_list()
    mapping = load_existing()
    todo = [s for s in songs if s[0] not in mapping]
    log(f"Total: {len(songs)} | already mapped: {len(songs) - len(todo)} | todo: {len(todo)}")

    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": "in_playlist",
    }
    ydl = yt_dlp.YoutubeDL(opts)

    found = miss = err = 0
    t0 = time.time()
    for i, (sid, title, artist) in enumerate(todo, 1):
        q = f"ytsearch1:{title} {artist}"
        try:
            info = ydl.extract_info(q, download=False)
            entries = info.get("entries", [])
            if entries and entries[0].get("id"):
                mapping[sid] = entries[0]["id"]
                found += 1
            else:
                mapping[sid] = None
                miss += 1
        except Exception as e:
            mapping[sid] = None
            err += 1
            log(f"  ERR {sid}: {str(e)[:120]}")

        if i % SAVE_EVERY == 0 or i == len(todo):
            save(mapping)
            elapsed = time.time() - t0
            rate = i / elapsed if elapsed > 0 else 0
            eta = (len(todo) - i) / rate if rate > 0 else 0
            log(
                f"  progress {i}/{len(todo)}  found={found} miss={miss} err={err}  "
                f"rate={rate:.2f}/s  eta={eta/60:.1f}min"
            )

        time.sleep(SLEEP_BETWEEN)

    log(f"Done. found={found} miss={miss} err={err}  total_mapped={sum(1 for v in mapping.values() if v)}")


if __name__ == "__main__":
    main()
