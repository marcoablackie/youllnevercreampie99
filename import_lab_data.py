#!/usr/bin/env python3
"""Fetch real NBA2KLab timing rows with a premium Firebase access token."""
import json
import os
import sys
import urllib.request
from pathlib import Path

API = "https://www.nba2klab.com/.netlify/functions/shots"


def post(token: str, year: int, type_: str):
    payload = json.dumps({"token": token, "year": year, "type": type_}).encode()
    req = urllib.request.Request(
        API,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
        method="POST",
    )
    body = urllib.request.urlopen(req, timeout=120).read().decode()
    data = json.loads(body)
    if data.get("status") == "missing-information":
        raise SystemExit("API returned missing-information — check your token")
    return data.get("shots") or data.get("data") or []


def index_shots(shots, key_field):
    out = {}
    for row in shots:
        if not row or row.get("earliest_green") is None:
            continue
        key = row.get(key_field) or row.get("name")
        if not key or "Sign Up" in str(key) or "Premium" in str(key):
            continue
        out[key] = {
            "earliest_green": row["earliest_green"],
            "latest_green": row.get("latest_green"),
        }
    return out


def main():
    token = os.environ.get("NBA2KLAB_TOKEN") or (sys.argv[1] if len(sys.argv) > 1 else "")
    if not token:
        raise SystemExit("Usage: NBA2KLAB_TOKEN=... python import_lab_data.py")

    bases = post(token, 24, "bases")
    releases = post(token, 24, "releases")
    custom = post(token, 26, "custom")

    cache = {
        "syncedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "bases": index_shots(bases, "base"),
        "releases": index_shots(releases, "releaseID"),
        "custom": [r for r in custom if r.get("earliest_green") is not None],
    }

    out = Path(__file__).parent / "lab_cache_export.json"
    out.write_text(json.dumps(cache, indent=2), encoding="utf-8")
    print(f"Saved {len(cache['bases'])} bases, {len(cache['releases'])} releases, {len(cache['custom'])} custom -> {out}")

    for name in ("Charles Bassey", "Cameron Thomas", "Collin Sexton", "Stephen Curry"):
        b = cache["bases"].get(name)
        if b:
            eg = b["earliest_green"]
            print(f"  {name} base: speed={eg}ms set_point={eg - 70}ms pgw={b.get('latest_green', 0) - eg if b.get('latest_green') else '?'}")


if __name__ == "__main__":
    main()