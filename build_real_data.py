#!/usr/bin/env python3
"""Regenerate scraped timing constants embedded in data.js."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent
MARKERS = (
    "/* === SCRAPED DATA (auto-generated) === */",
    "/* === REAL LAB DATA (auto-generated) === */",
)


def load_moving_jumpers():
    props = json.loads((ROOT / "lab_moving-jumpers_props.json").read_text(encoding="utf-8"))
    rows = []
    for row in props.get("jumpers", []):
        early, late = row.get("Early"), row.get("Late")
        if early in ("", None) or late in ("", None):
            continue
        try:
            early_ms = int(early)
            late_ms = int(late)
        except (TypeError, ValueError):
            continue
        rows.append({
            "jumper": row["Jumper"],
            "turbo": row.get("Turbo") == "Yes",
            "hand": row.get("Hand", "Main"),
            "early_ms": early_ms,
            "late_ms": late_ms,
            "window_ms": late_ms - early_ms,
        })
    return rows


def load_scraped_custom():
    path = ROOT / "lab_timings_extracted.json"
    if not path.exists():
        return []
    rows = []
    gated_words = ("sign up", "premium", "use code", "hacker", "discount")
    for row in json.loads(path.read_text(encoding="utf-8")):
        if row.get("earliest_green") is None:
            continue
        blob = " ".join(
            str(row.get(k) or "") for k in ("base", "release_1", "release_2", "releaseID")
        ).lower()
        rows.append({
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
            "gated": any(w in blob for w in gated_words),
            "source": "scraped-chunk",
        })
    return rows


def js_array(obj):
    return json.dumps(obj, indent=2, ensure_ascii=False)


def strip_generated_tail(text):
    for marker in MARKERS:
        idx = text.find(marker)
        if idx != -1:
            return text[:idx].rstrip()
    # legacy: strip from first GO_TO_LAB if no marker
    m = re.search(r"\n/\* Go-To rows scraped", text)
    if m:
        return text[: m.start()].rstrip()
    return text.rstrip()


def strip_premium_api_block(text):
    """Remove premium-only API/cache blocks without touching SHOTS."""
    text = re.sub(
        r"\n/\*\s*\n \* Filled by in-app NBA2KLab sync[\s\S]*?const LAB_PART_TIMINGS = \{[\s\S]*?\};\s*",
        "\n",
        text,
        count=1,
    )
    text = re.sub(r"\nconst LAB_API = [^\n]+;\s*", "\n", text)
    text = re.sub(r"\nconst LAB_CACHE_KEY = [^\n]+;\s*", "\n", text)
    return text


def patch_data_js():
    text = (ROOT / "data.js").read_text(encoding="utf-8")
    if "const SHOTS" not in text:
        raise SystemExit("data.js missing SHOTS — restore from git first")

    head = strip_generated_tail(text)
    head = strip_premium_api_block(head)

    moving = load_moving_jumpers()
    custom = load_scraped_custom()

    tail = f"""
{MARKERS[0]}
/* Go-to shot timings — scraped from public moving-jumpers page. */
const SCRAPED_GO_TO = {js_array(moving)};

/* Custom jumper builds — scraped from hidden data chunk (incl. gated rows with real ms). */
const SCRAPED_CUSTOM = {js_array(custom)};

const GO_TO_LAB = SCRAPED_GO_TO;
const LAB_PUBLIC_CUSTOM = SCRAPED_CUSTOM;
"""
    (ROOT / "data.js").write_text(head + tail, encoding="utf-8")
    print(f"SCRAPED_GO_TO: {len(moving)} rows")
    print(f"SCRAPED_CUSTOM: {len(custom)} rows ({sum(1 for r in custom if r.get('gated'))} gated)")


if __name__ == "__main__":
    patch_data_js()