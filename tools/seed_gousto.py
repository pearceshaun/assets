#!/usr/bin/env python3
"""Seed Gousto recipe thumbnails into assets/gousto/by-recipe/<core_id>.jpg.

Runs in CI in the pearceshaun/assets repo. No Gousto auth needed: the menu
endpoint is public (X-Gousto-Device-Id header only). Fetches the current menu
plus the next two delivery weeks, downscales each recipe photo to 640px JPEG,
and writes content-addressed files, skipping ids already present.

Canonical source: skills/gousto-account/seeder/seed_gousto.py in the private
claude repo. Installed copy: tools/seed_gousto.py in pearceshaun/assets. The
crop-selection + resize logic mirrors gousto.py's _best_image / make_thumbnail;
keep them in sync (it cannot import gousto.py -- that repo is private).
"""
import io
import json
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path

from PIL import Image

BASE = "https://production-api.gousto.co.uk"
MENU_PATH = (
    "/menu/v3/menus?include_core_recipe_id=true&include_core_menu_id=true"
    "&num_portions=2&option_types=none&option_types=recipes&option_types=ingredients"
)
DEVICE_ID = "gousto-account-skill"
OUT_DIR = Path("assets/gousto/by-recipe")
WIDTH = 640
QUALITY = 85
WEEKS_AHEAD = 2


def fetch_menu(delivery_date=None):
    path = MENU_PATH + (f"&delivery_date={delivery_date}" if delivery_date else "")
    req = urllib.request.Request(
        BASE + path,
        headers={
            "Accept": "application/json",
            "Origin": "https://www.gousto.co.uk",
            "X-Gousto-Device-Id": DEVICE_ID,
            "User-Agent": "gousto-thumbnail-seeder/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def best_crop(recipe, min_width=WIDTH):
    """Smallest crop at least min_width wide, else the widest available."""
    images = recipe.get("images") or []
    if not images:
        return None
    crops = images[0].get("crops") or []
    if not crops:
        return None
    big = [c for c in crops if c.get("width", 0) >= min_width]
    best = min(big, key=lambda c: c["width"]) if big else max(
        crops, key=lambda c: c.get("width", 0)
    )
    return best.get("url")


def recipe_index(menu):
    """{ str(core_id): image_url } for every recipe with a usable crop."""
    out = {}
    for recipe in (menu.get("recipes") or {}).values():
        core_id = recipe.get("core_recipe_id")
        url = best_crop(recipe)
        if core_id and url:
            out[str(core_id)] = url
    return out


def delivery_dates(menu):
    """The next WEEKS_AHEAD weekly delivery dates after the menu's period start."""
    start = (menu.get("period") or {}).get("when_start")
    if not start:
        return []
    try:
        d0 = datetime.fromisoformat(start).date()
    except ValueError:
        return []
    return [(d0 + timedelta(days=7 * i)).isoformat() for i in range(1, WEEKS_AHEAD + 1)]


def make_thumb(core_id, url):
    out = OUT_DIR / f"{core_id}.jpg"
    if out.exists():
        return "existing"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": DEVICE_ID})
        with urllib.request.urlopen(req, timeout=30) as resp:
            src = resp.read()
        im = Image.open(io.BytesIO(src)).convert("RGB")
        height = max(1, round(im.height * WIDTH / im.width))
        out.parent.mkdir(parents=True, exist_ok=True)
        im.resize((WIDTH, height), Image.LANCZOS).save(
            out, format="JPEG", quality=QUALITY, optimize=True
        )
        return "created"
    except (urllib.error.URLError, OSError) as e:
        print(f"  ! {core_id}: {e}", file=sys.stderr)
        return "error"


def main():
    index = {}
    # Let the initial fetch propagate: if the menu is unreachable the CI job
    # should fail loudly, since there is nothing to seed.
    current = fetch_menu()
    index.update(recipe_index(current))
    for date in delivery_dates(current):
        try:
            index.update(recipe_index(fetch_menu(date)))
        except (urllib.error.URLError, OSError) as e:
            print(f"skip {date}: {e}", file=sys.stderr)
    print(f"{len(index)} distinct recipes across current + {WEEKS_AHEAD} weeks")
    with ThreadPoolExecutor(max_workers=8) as pool:
        # map unpacks the two iterables as positional args to make_thumb(core_id, url)
        results = list(pool.map(make_thumb, index.keys(), index.values()))
    created = results.count("created")
    existing = results.count("existing")
    errors = results.count("error")
    print(f"created={created} existing={existing} errors={errors}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
