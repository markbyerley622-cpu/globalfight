"""Self-hosted fighter-photo background removal (rembg / U2Net).

Reads scripts/.photowork/worklist.json ([{slug, imageUrl}]), removes each
photo's background, composites the cut-out onto a solid BLACK background, and
writes public/fighters/<slug>.png. Records the processed slugs in done.json so
scripts/photos-apply.mts can point each fighter's imageUrl at the local file.

Usage:  python scripts/photos_bg.py [limit]
The U2Net model loads once and is reused for the whole batch.
"""
import json, os, io, sys, time

import requests
from PIL import Image
from rembg import remove, new_session

# Wikimedia's UA policy wants a descriptive agent WITH contact info, and they 429
# a client that hammers them (we did). Match the app's identity + throttle every
# download. Same honest posture as src/lib/http-identity.ts.
USER_AGENT = "CombatRegisterBot/2.0 (+https://combat-register.vercel.app/bot)"
THROTTLE_S = float(os.environ.get("PHOTO_THROTTLE_S", "1.0"))
_last = [0.0]


def polite_get(url: str):
    """Throttled GET that honours a 429 with a single backed-off retry."""
    wait = THROTTLE_S - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    r = requests.get(url, timeout=30, headers={"user-agent": USER_AGENT})
    if r.status_code == 429:
        retry_after = float(r.headers.get("retry-after") or 5)
        time.sleep(min(retry_after, 30))
        _last[0] = time.time()
        r = requests.get(url, timeout=30, headers={"user-agent": USER_AGENT})
    r.raise_for_status()
    return r

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKDIR = os.path.join(ROOT, "scripts", ".photowork")
# NOTE: /headshots (NOT /fighters — that path is quarantined by media-safe.ts as
# the old unlicensed corpus). isSafeImageUrl allows /headshots so these render.
OUT = os.path.join(ROOT, "public", "headshots")
os.makedirs(OUT, exist_ok=True)

work = json.load(open(os.path.join(WORKDIR, "worklist.json"), encoding="utf-8"))
limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0
if limit > 0:
    work = work[:limit]

session = new_session("u2net")
done = []
for i, item in enumerate(work):
    slug, url = item["slug"], item["imageUrl"]
    outp = os.path.join(OUT, f"{slug}.png")
    if os.path.exists(outp):        # resume: already processed in a prior run
        done.append(slug)
        continue
    try:
        r = polite_get(url)
        img = Image.open(io.BytesIO(r.content)).convert("RGBA")
        cut = remove(img, session=session)                       # RGBA, bg → transparent
        bg = Image.new("RGBA", cut.size, (0, 0, 0, 255))         # solid black
        comp = Image.alpha_composite(bg, cut).convert("RGB")
        comp.thumbnail((512, 512))                               # keep files reasonable
        comp.save(outp, "PNG")
        done.append(slug)
    except Exception as e:
        print("skip", slug, repr(str(e)[:80]), flush=True)
    if (i + 1) % 25 == 0:
        print(f"{i + 1}/{len(work)} processed", flush=True)

json.dump(done, open(os.path.join(WORKDIR, "done.json"), "w"))
print("done:", len(done), "of", len(work), flush=True)
