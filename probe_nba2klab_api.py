#!/usr/bin/env python3
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
CHUNKS = [
    "https://www.nba2klab.com/_next/static/chunks/commons-a3dad144-df60905f631372a3.js",
    "https://www.nba2klab.com/_next/static/chunks/commons-f88dba18-23b01b4e14ba2230.js",
    "https://www.nba2klab.com/_next/static/chunks/pages/premium-dribble-pull-ups-843bb07905a968c0.js",
]

for i, url in enumerate(CHUNKS):
    name = ROOT / f"nba2klab_chunk_{i}.js"
    if not name.exists() or name.stat().st_size < 1000:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            name.write_bytes(resp.read())
    text = name.read_text(encoding="utf-8", errors="replace")
    print(f"\n=== {name.name} ({len(text)} bytes) ===")
    for pat in ["three-moving", "go-to", "goto", "go_to", "category", "cloudfunctions", "firebase", "earliest_green"]:
        if pat in text:
            print(f"  contains: {pat}")
    cats = set(re.findall(r'category:"([a-zA-Z0-9\-]+)"', text))
    cats |= set(re.findall(r"category:'([a-zA-Z0-9\-]+)'", text))
    if cats:
        print("  categories:", sorted(cats))
    urls = sorted({u for u in re.findall(r"https?://[a-zA-Z0-9_./\-]+", text) if any(k in u for k in ("cloudfunctions", "firebase", "nba2klab", "api"))})
    for u in urls[:20]:
        print("  url:", u)