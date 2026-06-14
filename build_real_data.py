#!/usr/bin/env python3
"""Regenerate real-only data constants for data.js from NBA2KLab public sources."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent
MARKER = "/* === REAL LAB DATA (auto-generated) === */"

GATED = ("sign up", "premium", "use code", "hacker", "discount", "nba players")


def is_gated(*parts):
    blob = " ".join(str(p or "") for p in parts).lower()
    return any(g in blob for g in GATED)


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


def load_public_custom():
    path = ROOT / "lab_timings_extracted.json"
    if not path.exists():
        return []
    rows = []
    for row in json.loads(path.read_text(encoding="utf-8")):
        if row.get("earliest_green") is None:
            continue
        if is_gated(row.get("base"), row.get("release_1"), row.get("release_2"), row.get("releaseID")):
            continue
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
            "source": "lab-public",
        })
    return rows


def js_array(obj):
    return json.dumps(obj, indent=2, ensure_ascii=False)


def patch_data_js():
    text = (ROOT / "data.js").read_text(encoding="utf-8")
    if not text.strip():
        raise SystemExit("data.js is empty — restore from git first")

    head = text.split(MARKER)[0].rstrip()
    if "const TYPE_TIMING" in head:
        head = re.sub(r"\n/\* Estimated timing[\s\S]*", "\n", head)

    moving = load_moving_jumpers()
    custom = load_public_custom()

    tail = f"""
{MARKER}
/* Go-To rows scraped from nba2klab.com/moving-jumpers (public). */
const GO_TO_LAB = {js_array(moving)};

/* Public custom builds from NBA2KLab data chunks (non-gated rows only). */
const LAB_PUBLIC_CUSTOM = {js_array(custom)};
"""
    (ROOT / "data.js").write_text(head + tail, encoding="utf-8")
    print(f"GO_TO_LAB: {len(moving)} rows")
    print(f"LAB_PUBLIC_CUSTOM: {len(custom)} rows")


if __name__ == "__main__":
    patch_data_js()