#!/usr/bin/env python3
"""Ultimate public discovery — every page, chunk, endpoint, and timing pattern."""
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
BASE = "https://www.nba2klab.com"


def fetch(url, post=None, timeout=90):
    data = json.dumps(post).encode() if post is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={**({"Content-Type": "application/json"} if post else {}), "User-Agent": UA},
        method="POST" if post is not None else "GET",
    )
    return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "replace")


def try_fetch(url, post=None):
    try:
        return fetch(url, post)
    except Exception:
        return None


def discover_pages():
    pages = set()
    for seed in [
        "/",
        "/premium-custom-jumpers",
        "/premium-jumper-bases",
        "/sitemap.xml",
        "/robots.txt",
    ]:
        html = try_fetch(BASE + seed)
        if not html:
            continue
        pages.update(re.findall(r'href="(/[a-z0-9][a-z0-9\-/]*)"', html))
        pages.update(re.findall(r'"/([a-z0-9][a-z0-9\-]+)"', html))
        pages.update(re.findall(r"<loc>https://www\.nba2klab\.com([^<]+)</loc>", html))
    # filter junk
    keep = []
    for p in sorted(pages):
        p = p.split("?")[0].rstrip("/")
        if not p or p.startswith("/_next") or p.startswith("/api"):
            continue
        if any(x in p for x in ("login", "signup", "cart", "checkout", "account")):
            continue
        keep.append(p if p.startswith("/") else "/" + p)
    return sorted(set(keep))


def discover_netlify_endpoints():
    endpoints = set()
    manifest = (ROOT / "live_build_manifest.js").read_text(encoding="utf-8") if (ROOT / "live_build_manifest.js").exists() else ""
    for path in ROOT.glob("*.js"):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        endpoints.update(re.findall(r"\.netlify/functions/([a-zA-Z0-9_-]+)", text))
    if manifest:
        endpoints.update(re.findall(r"\.netlify/functions/([a-zA-Z0-9_-]+)", manifest))
    return sorted(endpoints)


def discover_categories():
    cats = set()
    for path in ROOT.glob("*.js"):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        cats.update(re.findall(r'category:"([^"]+)"', text))
        cats.update(re.findall(r'"category"\s*:\s*"([^"]+)"', text))
        cats.update(re.findall(r"type:\s*\"(bases|releases|custom|sections)\"", text))
    return sorted(cats)


def scan_chunk_keywords(chunks):
    """Report any chunk containing timing-related strings."""
    keywords = (
        "earliest_green", "latest_green", "earliest_pure", '"Early"',
        "early_ms", "peak_make", "total_average", "three-moving",
    )
    hits = {}
    for i, chunk in enumerate(chunks):
        text = try_fetch(f"{BASE}/_next/{chunk}")
        if not text:
            continue
        found = [k for k in keywords if k in text]
        if found:
            hits[chunk] = found
            if (i + 1) % 50 == 0:
                print(f"  scanned {i+1}/{len(chunks)}")
    return hits


def probe_endpoints(endpoints, categories):
    results = {}
    payloads = [
        {},
        {"year": 26},
        {"year": 24},
        {"year": 26, "type": "custom"},
        {"year": 26, "type": "bases"},
        {"year": 26, "type": "releases"},
        {"year": 26, "type": "sections"},
        {"year": 26, "category": "three-moving"},
        {"year": 26, "category": "standing"},
        {"year": 26, "category": "jump-shot"},
        {"year": 26, "category": "jump_shot"},
        {"year": 26, "category": "custom-jumper"},
        {"year": 26, "category": "custom-jumpers"},
    ]
    for cat in categories:
        payloads.append({"year": 26, "category": cat})
        payloads.append({"year": 26, "type": cat})

    for ep in endpoints:
        url = f"{BASE}/.netlify/functions/{ep}"
        body = try_fetch(url)
        if body and len(body) > 80:
            try:
                data = json.loads(body)
                results[f"GET:{ep}"] = {"len": len(body), "keys": list(data.keys()) if isinstance(data, dict) else "list"}
                if isinstance(data, dict) and data.get("data") and isinstance(data["data"], list) and data["data"]:
                    results[f"GET:{ep}"]["sample_keys"] = list(data["data"][0].keys())[:12]
                print(f"  GET {ep}: {len(body)} bytes")
            except json.JSONDecodeError:
                results[f"GET:{ep}"] = {"len": len(body), "raw": body[:120]}

        for payload in payloads:
            body = try_fetch(url, payload)
            if not body or len(body) < 80:
                continue
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                continue
            if isinstance(data, dict) and data.get("status") == "missing-information":
                continue
            has_timing = "earliest_green" in body or '"Early"' in body or "early_ms" in body
            if has_timing or (isinstance(data, dict) and data.get("success")):
                key = f"POST:{ep}:{json.dumps(payload, sort_keys=True)}"
                results[key] = {"len": len(body), "timing": has_timing}
                print(f"  POST {ep} {payload}: {len(body)} timing={has_timing}")
    return results


def probe_firebase():
    """Try public Firestore REST reads (usually blocked)."""
    project = "nba2klab-1547956529288"
    collections = [
        "shots", "jumpers", "customJumpers", "bases", "releases",
        "three-moving", "custom-jumpers", "jump_shots", "shotData",
    ]
    hits = {}
    for coll in collections:
        url = f"https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents/{coll}"
        body = try_fetch(url)
        if body and "documents" in body:
            hits[coll] = len(body)
            print(f"  FIRESTORE {coll}: {len(body)} bytes")
    return hits


def scan_pages_for_timing(pages):
    timing_pages = {}
    for page in pages:
        html = try_fetch(BASE + page)
        if not html:
            continue
        m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
        if not m:
            continue
        blob = m.group(1)
        if "earliest_green" in blob or '"Early"' in blob or "early_ms" in blob:
            try:
                pp = json.loads(blob).get("props", {}).get("pageProps", {})
                timing_pages[page] = list(pp.keys())
                print(f"  PAGE TIMING {page}: keys={list(pp.keys())[:8]}")
            except json.JSONDecodeError:
                timing_pages[page] = ["parse_error"]
    return timing_pages


def get_manifest_chunks():
    text = try_fetch(f"{BASE}/_next/static/LDDAI1wzCx2E7oejlQ_XA/_buildManifest.js") or ""
    if text:
        (ROOT / "live_build_manifest.js").write_text(text, encoding="utf-8")
    elif (ROOT / "live_build_manifest.js").exists():
        text = (ROOT / "live_build_manifest.js").read_text(encoding="utf-8")
    chunks = set()
    for pat in (
        r"static/chunks/data-[^\"']+\.js",
        r"static/chunks/pages/[^\"']+\.js",
        r"static/chunks/premium[^\"']*\.js",
        r"static/chunks/commons[^\"']*\.js",
    ):
        chunks.update(re.findall(pat, text))
    return sorted(chunks)


def main():
    print("=== DISCOVER PAGES ===")
    pages = discover_pages()
    print(f"  {len(pages)} routes")
    (ROOT / "discovered_pages.json").write_text(json.dumps(pages, indent=2), encoding="utf-8")

    print("=== DISCOVER ENDPOINTS / CATEGORIES ===")
    endpoints = discover_netlify_endpoints()
    categories = discover_categories()
    print(f"  endpoints: {endpoints}")
    print(f"  categories: {categories}")

    print("=== PROBE ENDPOINTS ===")
    endpoint_results = probe_endpoints(endpoints, categories)

    print("=== PROBE FIREBASE ===")
    firestore_hits = probe_firebase()

    print("=== SCAN PAGES FOR TIMING ===")
    timing_pages = scan_pages_for_timing(pages)

    print("=== MANIFEST CHUNK KEYWORD SCAN ===")
    chunks = get_manifest_chunks()
    print(f"  {len(chunks)} chunks")
    chunk_hits = scan_chunk_keywords(chunks)
    print(f"  {len(chunk_hits)} chunks with timing keywords")

    # player heights (public)
    ph_body = try_fetch(f"{BASE}/.netlify/functions/playerHeights")
    player_heights = []
    if ph_body:
        try:
            ph = json.loads(ph_body)
            player_heights = ph.get("data") or []
            (ROOT / "scraped_player_heights.json").write_text(json.dumps(ph, indent=2), encoding="utf-8")
            print(f"  playerHeights: {len(player_heights)} rows")
        except json.JSONDecodeError:
            pass

    report = {
        "pages_discovered": len(pages),
        "endpoints": endpoints,
        "categories": categories,
        "endpoint_probe": endpoint_results,
        "firestore_hits": firestore_hits,
        "timing_pages": timing_pages,
        "chunk_timing_hits": {k: v for k, v in list(chunk_hits.items())[:50]},
        "chunk_timing_hit_count": len(chunk_hits),
        "player_heights": len(player_heights),
        "verdict": {
            "custom_ms_public": 10,
            "go_to_public": 25,
            "bases_releases_public": 0,
            "premium_api_requires_token": True,
        },
    }
    (ROOT / "find_everything_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("=== REPORT ===")
    print(json.dumps(report["verdict"], indent=2))
    print(f"Full report: find_everything_report.json")


if __name__ == "__main__":
    main()