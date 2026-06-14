#!/usr/bin/env python3
"""Exhaustive public scrape for ANY jumpshot timing data."""
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
    except Exception as exc:
        return None


def parse_json_blobs(text):
    records = []
    # JSON.parse('...')
    for raw in re.findall(r"JSON\.parse\('((?:\\'|[^'])*)'\)", text):
        try:
            blob = json.loads(raw.replace("\\'", "'"))
        except json.JSONDecodeError:
            continue
        records.extend(extract_timing_records(blob))
    # raw JSON arrays/objects in file
    for m in re.finditer(r'\{[^{}]*"earliest_green"\s*:\s*\d+[^{}]*\}', text):
        try:
            obj = json.loads(m.group(0))
            if obj.get("earliest_green") is not None:
                records.append(obj)
        except json.JSONDecodeError:
            pass
    # larger s arrays
    for m in re.finditer(r'"s"\s*:\s*\[', text):
        start = m.start()
        chunk = text[start : start + 500000]
        depth = 0
        for i, ch in enumerate(chunk):
            if ch == "[":
                depth += 1
            elif ch == "]":
                depth -= 1
                if depth == 0:
                    try:
                        arr = json.loads("{" + chunk[: i + 1] + "}")["s"]
                        records.extend(extract_timing_records(arr))
                    except Exception:
                        pass
                    break
    return records


def extract_timing_records(blob):
    records = []
    if isinstance(blob, list):
        items = blob
    elif isinstance(blob, dict):
        for key in ("s", "shots", "data", "jumpers", "bases", "releases", "custom", "rows"):
            if isinstance(blob.get(key), list):
                items = blob[key]
                break
        else:
            if blob.get("earliest_green") is not None or blob.get("Early") is not None:
                items = [blob]
            else:
                items = []
    else:
        items = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get("earliest_green") is not None:
            records.append(normalize_custom(item))
        elif item.get("Early") not in (None, "", 0) and item.get("Late") not in (None, "", 0):
            try:
                early, late = int(item["Early"]), int(item["Late"])
                records.append({
                    "type": "go_to",
                    "jumper": item.get("Jumper") or item.get("jumper"),
                    "turbo": (item.get("Turbo") == "Yes") if isinstance(item.get("Turbo"), str) else item.get("turbo"),
                    "hand": item.get("Hand") or item.get("hand") or "Main",
                    "early_ms": early,
                    "late_ms": late,
                    "window_ms": late - early,
                    "source": "scraped-goto",
                })
            except (TypeError, ValueError):
                pass
        elif item.get("early_ms") is not None and item.get("late_ms") is not None:
            records.append(item)
    return records


def normalize_custom(item):
    return {
        "type": "custom",
        "name": item.get("name") or item.get("shot_ID"),
        "base": item.get("base"),
        "release_1": item.get("release_1"),
        "release_2": item.get("release_2"),
        "releaseID": item.get("releaseID"),
        "blend": item.get("blend"),
        "rating_req": item.get("rating_req"),
        "min_height": item.get("min_height"),
        "max_height": item.get("max_height"),
        "earliest_green": item.get("earliest_green"),
        "latest_green": item.get("latest_green"),
        "earliest_pure": item.get("earliest_pure"),
        "latest_pure": item.get("latest_pure"),
        "total_average": item.get("total_average"),
        "early_average": item.get("early_average"),
        "recommended": item.get("recommended"),
        "patch": item.get("patch"),
        "source": item.get("source") or "scraped-chunk",
    }


def normalize_base_release(item, kind):
    name = item.get("base") if kind == "base" else (item.get("releaseID") or item.get("release_1") or item.get("name"))
    if not name or not item.get("earliest_green"):
        return None
    return {
        "type": kind,
        "name": name,
        "earliest_green": item["earliest_green"],
        "latest_green": item.get("latest_green"),
        "rating_req": item.get("rating_req"),
        "min_height": item.get("min_height"),
        "max_height": item.get("max_height"),
        "total_average": item.get("total_average"),
        "source": "scraped-" + kind,
    }


def get_manifest_chunks():
    manifests = [
        f"{BASE}/_next/static/LDDAI1wzCx2E7oejlQ_XA/_buildManifest.js",
        f"{BASE}/_next/static/chunks/buildManifest.js",
    ]
    text = ""
    for url in manifests:
        t = try_fetch(url)
        if t:
            text = t
            (ROOT / "live_build_manifest.js").write_text(t, encoding="utf-8")
            break
    if not text and (ROOT / "live_build_manifest.js").exists():
        text = (ROOT / "live_build_manifest.js").read_text(encoding="utf-8")
    patterns = [
        r"static/chunks/data-[^\"']+\.js",
        r"static/chunks/pages/[^\"']+\.js",
        r"static/chunks/premium[^\"']*\.js",
    ]
    chunks = set()
    for pat in patterns:
        chunks.update(re.findall(pat, text))
    return sorted(chunks)


def scan_pages():
    pages = [
        "/moving-jumpers",
        "/green-windows",
        "/day-1-jumpers",
        "/nba2k-best-jumpers",
        "/jumpshot-recommender",
        "/rhythm-practice-tool",
        "/premium-custom-jumpers",
        "/premium-jumper-bases",
        "/premium-jumper-releases",
        "/premium-dribble-pull-ups",
        "/premium-section-jumpers",
        "/premium-jumpers-database",
        "/animation-requirements",
        "/premium-custom-jumpers-2k24",
        "/premium-jumper-bases-2k24",
    ]
    records = []
    for page in pages:
        html = try_fetch(BASE + page)
        if not html:
            continue
        m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
        if not m:
            continue
        try:
            pp = json.loads(m.group(1)).get("props", {}).get("pageProps", {})
        except json.JSONDecodeError:
            continue
        found = extract_timing_records(pp)
        if found:
            for r in found:
                r["page"] = page
            records.extend(found)
            print(f"  PAGE HIT {page}: {len(found)}")
        # save props for inspection
        (ROOT / f"lab_{page.strip('/').replace('/', '_')}_props.json").write_text(
            json.dumps(pp, indent=2)[:800000], encoding="utf-8"
        )
    return records


def scan_netlify():
    endpoints = [
        "shots", "customJumpers", "sectionJumpers", "playerHeights",
        "buildRatings", "char", "freethrow", "leaderboard",
        "getShots", "jumperBases", "jumperReleases", "bases", "releases",
        "rateShot", "rateSectionShot",
    ]
    payloads = [
        {},
        {"year": 26},
        {"year": 24},
        {"year": 26, "type": "custom"},
        {"year": 26, "type": "bases"},
        {"year": 26, "type": "releases"},
        {"year": 24, "type": "bases"},
        {"year": 24, "type": "releases"},
        {"year": 26, "type": "sections"},
        {"year": 26, "type": "sections", "category": "three-moving"},
        {"year": 26, "category": "three-moving"},
    ]
    records = []
    for ep in endpoints:
        url = f"{BASE}/.netlify/functions/{ep}"
        body = try_fetch(url)
        if body and len(body) > 50:
            try:
                data = json.loads(body)
                found = extract_timing_records(data)
                if found:
                    print(f"  GET {ep}: {len(found)}")
                    records.extend(found)
            except json.JSONDecodeError:
                pass
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
            found = extract_timing_records(data)
            if found:
                print(f"  POST {ep} {payload}: {len(found)}")
                records.extend(found)
    return records


def scan_chunks(chunks):
    records = []
    hits = []
    for i, chunk in enumerate(chunks):
        url = f"{BASE}/_next/{chunk}"
        text = try_fetch(url)
        if not text:
            continue
        if "earliest_green" not in text and "Early" not in text and "early_ms" not in text:
            continue
        found = parse_json_blobs(text)
        if found:
            hits.append(chunk)
            records.extend(found)
            print(f"  CHUNK [{i+1}/{len(chunks)}] {chunk}: {len(found)}")
            fname = chunk.replace("static/chunks/", "").replace("/", "_")
            (ROOT / fname).write_text(text[:2_000_000], encoding="utf-8")
    return records, hits


def scan_local():
    records = []
    for path in ROOT.glob("*.js"):
        if path.stat().st_size > 8_000_000:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        if "earliest_green" not in text and '"Early"' not in text:
            continue
        found = parse_json_blobs(text)
        if found:
            print(f"  LOCAL {path.name}: {len(found)}")
            records.extend(found)
    return records


def dedupe(records):
    seen = set()
    out = []
    for r in records:
        if r.get("type") == "go_to":
            key = ("go_to", r.get("jumper"), r.get("turbo"), r.get("hand"), r.get("early_ms"))
        elif r.get("type") in ("base", "release"):
            key = (r.get("type"), r.get("name"), r.get("earliest_green"))
        else:
            key = (
                "custom",
                r.get("name"),
                r.get("base"),
                r.get("release_1"),
                r.get("release_2"),
                r.get("blend"),
                r.get("earliest_green"),
            )
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def main():
    print("=== PAGES ===")
    page_recs = scan_pages()

    print("=== NETLIFY ===")
    api_recs = scan_netlify()

    print("=== MANIFEST CHUNKS ===")
    chunks = get_manifest_chunks()
    print(f"  {len(chunks)} chunks to scan")
    chunk_recs, hits = scan_chunks(chunks)

    print("=== LOCAL JS ===")
    local_recs = scan_local()

    all_recs = dedupe(page_recs + api_recs + chunk_recs + local_recs)

    custom = [r for r in all_recs if r.get("type") == "custom" or (r.get("base") and r.get("earliest_green"))]
    goto = [r for r in all_recs if r.get("type") == "go_to" or r.get("jumper") and r.get("early_ms")]
    bases = [r for r in all_recs if r.get("type") == "base"]
    releases = [r for r in all_recs if r.get("type") == "release"]

    # re-classify custom
    custom_clean = []
    goto_clean = []
    for r in all_recs:
        if r.get("early_ms") and r.get("jumper"):
            goto_clean.append(r)
        elif r.get("earliest_green") is not None:
            custom_clean.append(r)

    out = {
        "summary": {
            "total": len(all_recs),
            "custom": len(custom_clean),
            "go_to": len(goto_clean),
            "bases": len(bases),
            "releases": len(releases),
            "chunk_hits": hits,
        },
        "custom": custom_clean,
        "go_to": goto_clean,
        "bases": bases,
        "releases": releases,
    }
    (ROOT / "scraped_everything.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    (ROOT / "lab_timings_extracted.json").write_text(
        json.dumps(custom_clean, indent=2), encoding="utf-8"
    )
    if goto_clean:
        jumpers = []
        for r in goto_clean:
            jumpers.append({
                "Jumper": r.get("jumper"),
                "Turbo": "Yes" if r.get("turbo") else "No",
                "Hand": r.get("hand") or "Main",
                "Early": r.get("early_ms"),
                "Late": r.get("late_ms"),
                "PGW": r.get("window_ms"),
            })
        (ROOT / "lab_moving-jumpers_props.json").write_text(
            json.dumps({"jumpers": jumpers}, indent=2), encoding="utf-8"
        )

    print("=== DONE ===", json.dumps(out["summary"], indent=2))


if __name__ == "__main__":
    main()