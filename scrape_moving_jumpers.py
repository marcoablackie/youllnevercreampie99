#!/usr/bin/env python3
"""Scrape NBA2KLab moving-jumpers (go-to style) timing data from __NEXT_DATA__."""
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
URL = "https://www.nba2klab.com/moving-jumpers"

req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req, timeout=60) as resp:
    html = resp.read().decode("utf-8", errors="replace")

(ROOT / "moving_jumpers.html").write_text(html, encoding="utf-8")

m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
if not m:
    print("No __NEXT_DATA__ found")
    raise SystemExit(1)

data = json.loads(m.group(1))
pp = data.get("props", {}).get("pageProps", {})
print("pageProps keys:", list(pp.keys()))

# Dump full pageProps for inspection
out = ROOT / "moving_jumpers_data.json"
out.write_text(json.dumps(pp, indent=2), encoding="utf-8")
print(f"Wrote {out}")

# Try common shapes
for key, val in pp.items():
    if isinstance(val, list) and val:
        print(f"\n{key}: {len(val)} items")
        print("  sample:", json.dumps(val[0], indent=2)[:500])