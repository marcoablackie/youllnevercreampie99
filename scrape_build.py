#!/usr/bin/env python3
"""Scrape NBA 2K26 shooting animation requirements and rebuild shots data."""

import json
import re
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).parent

ALLOWED_TYPES = {"jump_shot", "go_to", "dribble_pullup", "post_fade"}

SECTION_MAP = {
    "nba-2k26-go-to-shot-animation-requirements": "go_to",
    "nba-2k26-jump-shot-animation-requirements": "jump_shot",
    "nba-2k26-dribble-pull-up-animation-requirements": "dribble_pullup",
    "nba-2k26-post-fade-animation-requirements": "post_fade",
}

NAME_FIXES = {
    "dirk notitzki": "Dirk Nowitzki",
    "de'mar derozan": "DeMar DeRozan",
    "demar derozan": "DeMar DeRozan",
    "donte divencenzo": "Donte DiVincenzo",
}

SKIP_NAMES = {
    "basic", "normal", "normal 2", "normal 3", "pro", "pro 2", "pro 3", "elite", "elite 2",
    "basic 2", "big", "small", "tall", "short",
}

SOURCES = [
    ("gamerant", "https://gamerant.com/nba-2k26-all-shooting-animation-requirements/"),
    ("nba2kw_jumpshots", "https://nba2kw.com/all-nba-2k26-jumpshot-requirements"),
]


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8", errors="replace")


def clean_name(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("\u2019", "'").strip()
    text = re.sub(r"\s+", " ", text)
    fixed = NAME_FIXES.get(text.lower())
    return fixed if fixed else text


def normalize_height(h: str) -> str:
    h = h.strip().replace("\u2019", "'").replace('"', "")
    h = re.sub(r"\s+", " ", h)
    if re.match(r"^between\s", h, re.I):
        return h[0].upper() + h[1:]
    if re.match(r"^under\s", h, re.I):
        return h[0].upper() + h[1:]
    if re.match(r"^6'10\s+or\s+higher$", h, re.I):
        return "6'10 or higher"
    if re.match(r"^6'5\s+or\s+higher$", h, re.I):
        return "6'5 or higher"
    if re.match(r"^\d'[\d]+\"?$", h):
        return f"Between {h} and {h}"
    return h


def height_from_min_max(min_h: str, max_h: str) -> str:
    min_h = min_h.strip().replace('"', "")
    max_h = max_h.strip().replace('"', "")
    if min_h == max_h:
        return min_h
    return f"Between {min_h} and {max_h}"


def parse_gamerant(html: str) -> list[dict]:
    shots = []
    for section_id, shot_type in SECTION_MAP.items():
        pattern = rf'<h2[^>]*id="{section_id}"[^>]*>.*?</h2>(.*?)(?=<h2[^>]*id=|$)'
        m = re.search(pattern, html, re.S | re.I)
        if not m:
            print(f"  warn: section missing {section_id}")
            continue
        block = m.group(1)
        tables = re.findall(r"<table[^>]*>(.*?)</table>", block, re.S | re.I)
        if not tables:
            continue
        table = tables[0]
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S | re.I)
        headers = []
        for row in rows:
            cells = re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", row, re.S | re.I)
            cells = [clean_name(c) for c in cells]
            if not cells:
                continue
            lower = [c.lower() for c in cells]
            if "player package" in lower or "player" in lower[0]:
                headers = lower
                continue
            if not headers:
                continue
            data = dict(zip(headers, cells))
            name = data.get("player package") or data.get("animation") or cells[0]
            if not name or name.lower() in SKIP_NAMES:
                continue
            rating = None
            if shot_type != "post_fade":
                raw = data.get("midrange/3-pointer") or data.get("midrange/3-pt") or data.get("mid / 3pt")
                if raw:
                    try:
                        rating = int(re.sub(r"[^\d]", "", raw))
                    except ValueError:
                        rating = None
            height_raw = data.get("height") or ""
            height = normalize_height(height_raw) if height_raw else "Any height"
            shots.append({"name": name, "type": shot_type, "rating": rating, "height": height})
    return shots


class TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self._in_table = False
        self._in_row = False
        self._in_cell = False
        self._cur_table: list[list[str]] = []
        self._cur_row: list[str] = []
        self._buf: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._in_table = True
            self._cur_table = []
        elif self._in_table and tag == "tr":
            self._in_row = True
            self._cur_row = []
        elif self._in_row and tag in ("td", "th"):
            self._in_cell = True
            self._buf = []

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._in_cell:
            self._cur_row.append(clean_name("".join(self._buf)))
            self._in_cell = False
        elif tag == "tr" and self._in_row:
            if self._cur_row:
                self._cur_table.append(self._cur_row)
            self._in_row = False
        elif tag == "table" and self._in_table:
            if self._cur_table:
                self.tables.append(self._cur_table)
            self._in_table = False

    def handle_data(self, data):
        if self._in_cell:
            self._buf.append(data)


def parse_nba2kw_jumpshots(html: str) -> list[dict]:
    parser = TableParser()
    parser.feed(html)
    shots = []
    for table in parser.tables:
        if not table:
            continue
        header = [c.lower() for c in table[0]]
        if "mid / 3pt" not in header and "midrange" not in " ".join(header):
            continue
        idx_name = next(i for i, h in enumerate(header) if "player" in h)
        idx_rating = next(i for i, h in enumerate(header) if "mid" in h or "3pt" in h)
        idx_min = next((i for i, h in enumerate(header) if h == "min"), None)
        idx_max = next((i for i, h in enumerate(header) if h == "max"), None)
        if idx_min is None or idx_max is None:
            continue
        for row in table[1:]:
            if len(row) <= max(idx_name, idx_rating, idx_min, idx_max):
                continue
            name = row[idx_name].strip()
            if not name or name.lower() in SKIP_NAMES:
                continue
            try:
                rating = int(re.sub(r"[^\d]", "", row[idx_rating]))
            except ValueError:
                continue
            height = height_from_min_max(row[idx_min], row[idx_max])
            shots.append({"name": name, "type": "jump_shot", "rating": rating, "height": height})
        if shots:
            break
    return shots


def fetch_go_to_lab_timings() -> list[dict]:
    """NBA2KLab moving-jumpers page — public go-to style timing (ms)."""
    url = "https://www.nba2klab.com/moving-jumpers"
    try:
        html = fetch(url)
    except Exception as exc:
        print(f"  warn: moving-jumpers fetch failed ({exc})")
        return []
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        print("  warn: moving-jumpers __NEXT_DATA__ missing")
        return []
    jumpers = json.loads(m.group(1)).get("props", {}).get("pageProps", {}).get("jumpers", [])
    by_key: dict[tuple, dict] = {}
    for row in jumpers:
        if row.get("Turbo") != "No" or row.get("Hand") != "Main":
            continue
        early, late = row.get("Early"), row.get("Late")
        if early in ("", None) or late in ("", None):
            continue
        try:
            early_i, late_i = int(early), int(late)
            pgw = int(row.get("PGW") or 0)
        except (TypeError, ValueError):
            continue
        if late_i <= early_i:
            continue
        jumper = row.get("Jumper", "").strip()
        if not jumper or jumper.lower() in SKIP_NAMES:
            continue
        window = pgw if pgw > 0 else late_i - early_i
        by_key[(jumper.lower(),)] = {
            "jumper": jumper,
            "early_ms": early_i,
            "late_ms": late_i,
            "release_ms": round((early_i + late_i) / 2),
            "window_ms": window,
        }
    out = sorted(by_key.values(), key=lambda x: x["jumper"].lower())
    print(f"  NBA2KLab moving-jumpers: {len(out)} lab profiles")
    return out


def dedupe(shots: list[dict]) -> list[dict]:
    seen = {}
    for s in shots:
        key = (s["name"].lower(), s["type"])
        seen[key] = s
    out = list(seen.values())
    out.sort(key=lambda x: (x["type"], x["name"].lower()))
    return out


def emit_js(shots: list[dict], go_to_lab: list[dict], path: Path):
    lines = [
        "/*",
        " * NBA 2K26 Jumpshot Creator - SHOTS DATA",
        " * Scraped from GameRant + NBA2KW (Jun 2026). Unlock requirements only.",
        " * Go-To timings: NBA2KLab moving-jumpers (public) + estimates for unrated players.",
        " * Types: jump_shot, go_to, dribble_pullup, post_fade",
        " */",
        "const SHOTS = " + json.dumps(shots, indent=2, ensure_ascii=False) + ";",
        "",
        "const TYPE_LABELS = {",
        '  jump_shot: "Jump Shot",',
        '  go_to: "Go-To Shot",',
        '  dribble_pullup: "Dribble Pull-Up",',
        '  post_fade: "Post Fade",',
        "};",
        "",
        "const VISUAL_CUES = [",
        '  { name: "Set Point",   offset: 0.0,   note: "Release when the shot reaches its set point." },',
        '  { name: "Apex",        offset: 0.12,  note: "Release at the top of the jump." },',
        '  { name: "Push",        offset: -0.08, note: "Release as the hands push forward." },',
        '  { name: "Wrist Flick", offset: 0.06,  note: "Release on the wrist flick." }',
        "];",
        "",
        "/* In-game Release Speed slider — 4 discrete notches (not 0–100). */",
        "const RELEASE_SPEEDS = [",
        '  { label: "Slow",       factor: 25 },',
        '  { label: "Normal",     factor: 50 },',
        '  { label: "Quick",      factor: 75 },',
        '  { label: "Very Quick", factor: 100 }',
        "];",
        "",
        "const DEFAULT_RELEASE_SPEED_INDEX = 1;",
        "",
        "/* Estimated timing scale per package type (not published by 2K). */",
        "const TYPE_TIMING = {",
        "  jump_shot: 1.0,",
        "  dribble_pullup: 0.95,",
        "  post_fade: 1.1",
        "};",
        "",
        "/* Go-To lab timings — NBA2KLab moving-jumpers, Turbo=No, Main hand. */",
        "const GO_TO_LAB = " + json.dumps(go_to_lab, indent=2, ensure_ascii=False) + ";",
        "",
        "/* Fallback when no lab row: standing jump estimate * ratio + gather. */",
        "const GO_TO_ESTIMATE = { ratio: 1.52, gather_ms: 165, window_scale: 0.62 };",
        "",
        "/*",
        " * Researched green windows (ms) at Normal release speed + Set Point cue.",
        " * Sources: NBA2KLab moving-jumper PGW, 2K26 meta guides (AOEAH, community).",
        " */",
        "const GREEN_WINDOW_META = " + json.dumps({
            "Charles Bassey": {"window_ms": 68, "note": "2026 meta — largest tested window"},
            "Dirk Nowitzki": {"window_ms": 64, "note": "Big man high-release staple"},
            "David Robinson": {"window_ms": 61, "note": "Forgiving stretch big"},
            "Kevin Durant": {"window_ms": 58, "note": "Tall wing release"},
            "Cameron Thomas": {"window_ms": 56, "note": "Guard meta blend"},
            "Collin Sexton": {"window_ms": 55, "note": "Catch-and-shoot guard"},
            "Stephen Curry": {"window_ms": 54, "note": "High 3PT rating builds"},
            "Kyle Korver": {"window_ms": 53, "note": "Wing release"},
            "Mike Muscala": {"window_ms": 52, "note": "Stretch big"},
        }, indent=2, ensure_ascii=False) + ";",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def main():
    all_shots = []

    print("Fetching GameRant...")
    gr_html = (ROOT / "scrape_gamerant.html").read_text(encoding="utf-8", errors="replace")
    if len(gr_html) < 100000:
        gr_html = fetch(SOURCES[0][1])
        (ROOT / "scrape_gamerant.html").write_text(gr_html, encoding="utf-8")
    gr_shots = parse_gamerant(gr_html)
    gr_shots = [s for s in gr_shots if s["type"] in ALLOWED_TYPES]
    print(f"  GameRant: {len(gr_shots)} rows")

    print("Fetching NBA2KW jumpshots...")
    kw_html = (ROOT / "scrape_nba2kw.html").read_text(encoding="utf-8", errors="replace")
    if "Stephen Curry" not in kw_html or len(kw_html) < 50000:
        kw_html = fetch(SOURCES[1][1])
        (ROOT / "scrape_nba2kw.html").write_text(kw_html, encoding="utf-8")
    kw_shots = parse_nba2kw_jumpshots(kw_html)
    print(f"  NBA2KW jump shots: {len(kw_shots)} rows")

    # Prefer NBA2KW for jump_shot (more complete); GameRant for other types
    all_shots.extend(kw_shots)
    all_shots.extend([s for s in gr_shots if s["type"] != "jump_shot"])
    # Also merge GameRant jump shots not in NBA2KW
    kw_names = {s["name"].lower() for s in kw_shots}
    for s in gr_shots:
        if s["type"] == "jump_shot" and s["name"].lower() not in kw_names:
            all_shots.append(s)

    all_shots = dedupe(all_shots)
    all_shots = [s for s in all_shots if s["type"] in ALLOWED_TYPES]

    counts = {}
    for s in all_shots:
        counts[s["type"]] = counts.get(s["type"], 0) + 1

    print("Final counts:", counts, "total:", len(all_shots))

    print("Fetching NBA2KLab moving-jumpers (go-to timings)...")
    go_to_lab = fetch_go_to_lab_timings()

    emit_js(all_shots, go_to_lab, ROOT / "data.js")

    # Update index.html to only load data.js
    index = (ROOT / "index.html").read_text(encoding="utf-8")
    index = re.sub(r'\s*<script src="jumpshots\.js"></script>\s*', "\n", index)
    (ROOT / "index.html").write_text(index, encoding="utf-8")

    print("Wrote data.js")


if __name__ == "__main__":
    main()