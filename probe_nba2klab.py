#!/usr/bin/env python3
"""Probe NBA2KLab JS bundles for API/collection names."""
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
URL = "https://www.nba2klab.com/_next/static/chunks/pages/premium-dribble-pull-ups-843bb07905a968c0.js"
out = ROOT / "nba2klab_dribble.js"
if not out.exists() or out.stat().st_size < 1000:
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        out.write_bytes(resp.read())

text = out.read_text(encoding="utf-8", errors="replace")
print("bytes", len(text))
for pat in ["goTo", "go-to", "goto", "dribble", "firebase", "firestore", "earliest", "greenWindow", "collection", "getDocs"]:
    print(pat, text.count(pat))

strings = re.findall(r'"([a-zA-Z0-9_\-/]{4,80})"', text)
interesting = sorted({s for s in strings if any(k in s.lower() for k in ("dribble", "shot", "goto", "pull", "api", "firebase", "green", "timing", "ms"))})
print("interesting strings:")
for s in interesting[:80]:
    print(" ", s)