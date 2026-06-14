#!/usr/bin/env python3
"""Aggressive public scrape — manifest chunks, pages, netlify endpoints."""
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
UA = {"User-Agent": "Mozilla/5.0"}


def fetch(url, post=None):
    data = json.dumps(post).encode() if post is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={**UA, **({"Content-Type": "application/json"} if post is not None else {})},
        method="POST" if post is not None else "GET",
    )
    return urllib.request.urlopen(req, timeout=90).read().decode("utf-8", "replace")


def parse_json_blobs(text):
    records = []
    for raw in re.findall(r"JSON\.parse\('((?:\\'|[^'])*)'\)", text):
        try:
            blob = json.loads(raw.replace("\\'", "'"))
        except json.JSONDecodeError:
            continue
        if isinstance(blob, list):
            items = blob
        elif isinstance(blob, dict):
            items = blob.get("s") or blob.get("shots") or blob.get("data") or []
        else:
            continue
        for item in items:
            if isinstance(item, dict) and item.get("earliest_green") is not None:
                records.append(item)
    return records


def scan_manifest():
    urls = [
        "https://www.nba2klab.com/_next/static/LDDAI1wzCx2E7oejlQ_XA/_buildManifest.js",
        "https://www.nba2klab.com/_next/static/chunks/buildManifest.js",
    ]
    manifest = ""
    for url in urls:
        try:
            manifest = fetch(url)
            (ROOT / "live_build_manifest.js").write_text(manifest, encoding="utf-8")
            break
        except Exception:
            pass
    if not manifest and (ROOT / "live_build_manifest.js").exists():
        manifest = (ROOT / "live_build_manifest.js").read_text(encoding="utf-8")
    return sorted(set(re.findall(r"static/chunks/data-[^\"']+\.js", manifest)))


def scrape_chunks(chunks):
    all_records = []
    hits = []
    for chunk in chunks:
        url = f"https://www.nba2klab.com/_next/{chunk}"
        try:
            text = fetch(url)
        except Exception as exc:
            print(f"  skip {chunk}: {exc}")
            continue
        recs = parse_json_blobs(text)
        if recs:
            hits.append(chunk)
            all_records.extend(recs)
            local = ROOT / chunk.replace("static/chunks/", "")
            local.write_text(text, encoding="utf-8")
    return hits, all_records


def scrape_local_js():
    records = []
    for path in ROOT.glob("*.js"):
        if path.name in ("app.js", "data.js", "webpack.js"):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        if "earliest_green" not in text:
            continue
        recs = parse_json_blobs(text)
        if recs:
            print(f"  local hit {path.name}: {len(recs)}")
            records.extend(recs)
    return records


def scrape_moving_jumpers():
    html = fetch("https://www.nba2klab.com/moving-jumpers")
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        return []
    pp = json.loads(m.group(1)).get("props", {}).get("pageProps", {})
    return pp.get("jumpers", [])


def probe_endpoints():
    out = {}
    for ep, post in [
        ("playerHeights", None),
        ("buildRatings", {}),
        ("char", {}),
    ]:
        url = f"https://www.nba2klab.com/.netlify/functions/{ep}"
        try:
            body = fetch(url, post if post is not None else None)
            out[ep] = json.loads(body)
            n = len(out[ep]) if isinstance(out[ep], list) else "obj"
            print(f"  endpoint {ep}: {n}")
        except Exception as exc:
            print(f"  endpoint {ep} fail: {exc}")
    return out


def dedupe_custom(rows):
    seen = set()
    out = []
    for r in rows:
        key = (r.get("shot_ID") or r.get("name"), r.get("base"), r.get("release_1"), r.get("blend"))
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def main():
    print("=== manifest chunks ===")
    chunks = scan_manifest()
    print(f"  {len(chunks)} data chunks")
    hits, chunk_records = scrape_chunks(chunks)
    print(f"  timing hits: {hits}")

    print("=== local js ===")
    local_records = scrape_local_js()

    print("=== moving jumpers ===")
    jumpers = scrape_moving_jumpers()
    print(f"  {len(jumpers)} rows")

    print("=== endpoints ===")
    endpoints = probe_endpoints()

    custom = dedupe_custom(chunk_records + local_records)
    (ROOT / "lab_timings_extracted.json").write_text(json.dumps(custom, indent=2), encoding="utf-8")
    (ROOT / "lab_moving-jumpers_props.json").write_text(
        json.dumps({"jumpers": jumpers, "premium": True}, indent=2), encoding="utf-8"
    )
    if endpoints.get("playerHeights"):
        (ROOT / "scraped_player_heights.json").write_text(
            json.dumps(endpoints["playerHeights"], indent=2)[:500000], encoding="utf-8"
        )

    summary = {
        "custom_builds": len(custom),
        "go_to_rows": len(jumpers),
        "chunk_hits": hits,
        "player_heights": len(endpoints.get("playerHeights") or []),
    }
    (ROOT / "scrape_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("=== done ===", summary)


if __name__ == "__main__":
    main()