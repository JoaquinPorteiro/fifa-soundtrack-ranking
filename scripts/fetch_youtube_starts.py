#!/usr/bin/env python3
"""
For each YouTube video ID in data/youtube_ids.json, fetch the 'heatmap'
(YouTube's most-replayed segments) and save the peak start time to
data/youtube_starts.json. The peak is typically the chorus / hook.

Resumable: skips songs already mapped.
Usage: python3 scripts/fetch_youtube_starts.py
"""
import json
import os
import time
import warnings

warnings.filterwarnings("ignore")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IDS_JSON = os.path.join(ROOT, "data", "youtube_ids.json")
OUT_JSON = os.path.join(ROOT, "data", "youtube_starts.json")
LOG_PATH = os.path.join(ROOT, "data", "youtube_starts.log")
SAVE_EVERY = 20
SLEEP_BETWEEN = 0.5


def load_ids():
    with open(IDS_JSON, encoding="utf-8") as f:
        return json.load(f)


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


def find_peak_time(heatmap):
    """Return start_time (int seconds) of the most-replayed chunk, or None."""
    if not heatmap:
        return None
    peak = max(heatmap, key=lambda h: h.get("value", 0))
    if peak.get("value", 0) <= 0:
        return None
    return int(peak.get("start_time", 0))


def main():
    import yt_dlp

    ids = load_ids()
    starts = load_existing()
    candidates = [(sid, ytid) for sid, ytid in ids.items() if ytid]
    todo = [(sid, ytid) for sid, ytid in candidates if sid not in starts]
    log(
        f"Total videos: {len(candidates)} | already done: {len(candidates) - len(todo)} | "
        f"todo: {len(todo)}"
    )

    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "ignoreerrors": True,
    }
    ydl = yt_dlp.YoutubeDL(opts)

    found = miss = err = 0
    t0 = time.time()
    for i, (sid, ytid) in enumerate(todo, 1):
        url = f"https://www.youtube.com/watch?v={ytid}"
        try:
            info = ydl.extract_info(url, download=False)
            heatmap = info.get("heatmap") if info else None
            start = find_peak_time(heatmap)
            if start is not None:
                starts[sid] = start
                found += 1
            else:
                starts[sid] = None
                miss += 1
        except Exception as e:
            starts[sid] = None
            err += 1
            log(f"  ERR {sid}: {str(e)[:120]}")

        if i % SAVE_EVERY == 0 or i == len(todo):
            save(starts)
            elapsed = time.time() - t0
            rate = i / elapsed if elapsed > 0 else 0
            eta = (len(todo) - i) / rate if rate > 0 else 0
            log(
                f"  progress {i}/{len(todo)}  found={found} miss={miss} err={err}  "
                f"rate={rate:.2f}/s  eta={eta/60:.1f}min"
            )

        time.sleep(SLEEP_BETWEEN)

    log(f"Done. found={found} miss={miss} err={err}")


if __name__ == "__main__":
    main()
