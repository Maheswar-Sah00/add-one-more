#!/usr/bin/env python3
"""
Object-art pipeline for "One More Thing".

Takes the raw object images in `art-src/` and produces clean, game-ready PNGs in
`src/client/assets/objects/`:

  1. Background removal — flood-fills the background inward from the image edges,
     turning it transparent. It only removes pixels CONNECTED to the border and
     close in colour to the border, so a background-coloured area *inside* the
     object silhouette is preserved. Images that are already transparent are left
     as-is (only trimmed).
  2. Auto-trim — crops the fully-transparent margin so the object fills the frame.
     This is what lets the in-game code map each PNG cleanly onto the object's
     physics footprint.

Usage:
    python scripts/process-art.py            # process every PNG in art-src/
    python scripts/process-art.py box tyre   # process only these ids

Input files must be named by object id: box, book, brick, cushion, tray, chair,
lamp, tyre, television, plant, fridge, sofa, bathtub, canoe, duck  (e.g. box.png).
"""
from __future__ import annotations
import os
import sys
from collections import deque
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "art-src")
OUT_DIR = os.path.join(ROOT, "src", "client", "assets", "objects")

# Every playable object id (must match src/shared/objects.ts).
OBJECT_IDS = [
    "box", "book", "brick", "cushion", "tray",
    "chair", "lamp", "tyre", "television", "plant",
    "fridge", "sofa", "bathtub", "canoe", "duck",
]

COLOR_TOL = 48      # max per-channel distance from the border colour to treat as background
ALPHA_EDGE = 24     # alpha at/below this is treated as already-transparent
MAX_SIDE = 512      # cap the longest side — keeps high detail for zoomed-in / high-DPI drops
SHADOW_ALPHA = 60   # wipe pixels fainter than this (leftover soft drop-shadows) to fully transparent
TRIM_ALPHA = 150    # trim to the box of pixels at/above this alpha, so faint shadow never pads the frame


def _near(a, b, tol):
    return abs(a[0] - b[0]) <= tol and abs(a[1] - b[1]) <= tol and abs(a[2] - b[2]) <= tol


def remove_background(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()

    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    opaque = [c for c in corners if c[3] > ALPHA_EDGE]
    if not opaque:
        return img  # already has a transparent background — nothing to remove

    bg = tuple(sum(c[i] for c in opaque) // len(opaque) for i in range(3))

    visited = bytearray(w * h)
    dq: deque[tuple[int, int]] = deque()

    def consider(x, y):
        idx = y * w + x
        if visited[idx]:
            return
        r, g, b, a = px[x, y]
        if a <= ALPHA_EDGE or _near((r, g, b), bg, COLOR_TOL):
            visited[idx] = 1
            px[x, y] = (r, g, b, 0)
            dq.append((x, y))

    for x in range(w):
        consider(x, 0)
        consider(x, h - 1)
    for y in range(h):
        consider(0, y)
        consider(w - 1, y)

    while dq:
        x, y = dq.popleft()
        if x > 0:
            consider(x - 1, y)
        if x < w - 1:
            consider(x + 1, y)
        if y > 0:
            consider(x, y - 1)
        if y < h - 1:
            consider(x, y + 1)

    return img


def wipe_soft_shadows(img: Image.Image) -> Image.Image:
    """Zero out very-faint pixels — leftover soft drop-shadows from the source —
    while keeping the object's anti-aliased edges (which are much more opaque)."""
    img = img.convert("RGBA")
    r, g, b, a = img.split()
    a = a.point(lambda v: 0 if v < SHADOW_ALPHA else v)
    return Image.merge("RGBA", (r, g, b, a))


def trim(img: Image.Image) -> Image.Image:
    # Trim to the box of near-solid pixels so a faint halo/shadow never pads the
    # frame — that padding is what made rested objects float above the surface.
    solid = img.split()[3].point(lambda v: 255 if v >= TRIM_ALPHA else 0)
    bbox = solid.getbbox() or img.split()[3].getbbox()
    return img.crop(bbox) if bbox else img


def downscale(img: Image.Image) -> Image.Image:
    w, h = img.size
    longest = max(w, h)
    if longest <= MAX_SIDE:
        return img
    s = MAX_SIDE / longest
    return img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)


def process(object_id: str) -> bool:
    src = os.path.join(SRC_DIR, object_id + ".png")
    if not os.path.exists(src):
        return False
    img = Image.open(src)
    img = remove_background(img)
    img = wipe_soft_shadows(img)
    img = trim(img)
    img = downscale(img)
    os.makedirs(OUT_DIR, exist_ok=True)
    img.save(os.path.join(OUT_DIR, object_id + ".png"), optimize=True)
    print(f"  ok  {object_id:<11} -> {img.size[0]}x{img.size[1]}")
    return True


def main():
    ids = sys.argv[1:] or OBJECT_IDS
    print(f"art-src : {SRC_DIR}")
    print(f"output  : {OUT_DIR}\n")
    done, missing = [], []
    for oid in ids:
        (done if process(oid) else missing).append(oid)
    print(f"\nprocessed {len(done)} image(s).")
    if missing:
        print("missing (no art-src/<id>.png): " + ", ".join(missing))


if __name__ == "__main__":
    main()
