#!/usr/bin/env python3
"""Embed ALL scraped timing data into data.js."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent
MARKER = "/* === SCRAPED DATA (auto-generated) === */"
GATED_WORDS = ("sign up", "premium", "use code", "hacker", "discount", "nba players")


def is_gated(row):
    blob = " ".join(
        str(row.get(k) or "") for k in ("base", "release_1", "release_2", "releaseID", "name")
    ).lower()
    return any(w in blob for w in GATED_WORDS)


def load_player_heights():
    path = ROOT / "scraped_player_heights.json"
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = data.get("data") or []
    return [
        {
            "name": r.get("name"),
            "min_height": r.get("min_height"),
            "max_height": r.get("max_height"),
        }
        for r in rows
        if r.get("name") and r.get("min_height") is not None
    ]


def load_find_report():
    path = ROOT / "find_everything_report.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def load_from_scraped_everything():
    path = ROOT / "scraped_everything.json"
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        custom = []
        for row in data.get("custom", []):
            if row.get("earliest_green") is None:
                continue
            custom.append({
                "name": row.get("name"),
                "base": row.get("base"),
                "release_1": row.get("release_1"),
                "release_2": row.get("release_2"),
                "blend": row.get("blend"),
                "rating_req": row.get("rating_req"),
                "min_height": row.get("min_height"),
                "max_height": row.get("max_height"),
                "earliest_green": row.get("earliest_green"),
                "latest_green": row.get("latest_green"),
                "total_average": row.get("total_average"),
                "early_average": row.get("early_average"),
                "recommended": row.get("recommended"),
                "patch": row.get("patch"),
                "gated": is_gated(row),
                "source": row.get("source") or "scraped-chunk",
            })
        goto = []
        for row in data.get("go_to", []):
            if row.get("early_ms") is None:
                continue
            goto.append({
                "jumper": row.get("jumper"),
                "turbo": bool(row.get("turbo")),
                "hand": row.get("hand") or "Main",
                "early_ms": row["early_ms"],
                "late_ms": row["late_ms"],
                "window_ms": row.get("window_ms") or (row["late_ms"] - row["early_ms"]),
            })
        bases = [r for r in data.get("bases", []) if r.get("earliest_green")]
        releases = [r for r in data.get("releases", []) if r.get("earliest_green")]
        return custom, goto, bases, releases
    return None


def strip_generated_tail(text):
    for marker in (MARKER, "/* === REAL LAB DATA (auto-generated) === */"):
        idx = text.find(marker)
        if idx != -1:
            return text[:idx].rstrip()
    return text.rstrip()


def strip_premium_api_block(text):
    text = re.sub(
        r"\n/\*\s*\n \* Filled by in-app NBA2KLab sync[\s\S]*?const LAB_PART_TIMINGS = \{[\s\S]*?\};\s*",
        "\n",
        text,
        count=1,
    )
    text = re.sub(r"\nconst LAB_API = [^\n]+;\s*", "\n", text)
    text = re.sub(r"\nconst LAB_CACHE_KEY = [^\n]+;\s*", "\n", text)
    return text


def js_array(obj):
    return json.dumps(obj, indent=2, ensure_ascii=False)


def patch_data_js():
    text = (ROOT / "data.js").read_text(encoding="utf-8")
    if "const SHOTS" not in text:
        raise SystemExit("data.js missing SHOTS")

    loaded = load_from_scraped_everything()
    if not loaded:
        raise SystemExit("Run scrape_everything.py first")

    custom, goto, bases, releases = loaded
    player_heights = load_player_heights()
    report = load_find_report()
    head = strip_premium_api_block(strip_generated_tail(text))

    meta = {
        "custom_builds": len(custom),
        "go_to_rows": len(goto),
        "bases": len(bases),
        "releases": len(releases),
        "gated_custom": sum(1 for r in custom if r.get("gated")),
        "player_heights": len(player_heights),
        "chunks_scanned": 305,
        "pages_discovered": report.get("pages_discovered", 0),
        "endpoints_probed": len(report.get("endpoints", [])),
        "sources": [
            "moving-jumpers page (25 ms rows)",
            "data-59eba126 chunk (10 custom ms)",
            "playerHeights API (623 players)",
            "305 manifest chunks + 14 netlify endpoints scanned",
        ],
    }

    tail = f"""
{MARKER}
/* AUTO: scrape_everything.py + find_everything.py — ALL public data (no estimates). */
const SCRAPED_META = {js_array(meta)};

const SCRAPED_GO_TO = {js_array(goto)};

const SCRAPED_CUSTOM = {js_array(custom)};

const SCRAPED_BASES = {js_array(bases)};

const SCRAPED_RELEASES = {js_array(releases)};

const SCRAPED_PLAYER_HEIGHTS = {js_array(player_heights)};

const GO_TO_LAB = SCRAPED_GO_TO;
const LAB_PUBLIC_CUSTOM = SCRAPED_CUSTOM;
"""
    (ROOT / "data.js").write_text(head + tail, encoding="utf-8")
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    patch_data_js()