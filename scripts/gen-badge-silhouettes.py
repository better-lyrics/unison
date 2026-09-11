#!/usr/bin/env python3
"""Generate solid, hole-free black silhouettes for every badge.

The badge art has genuine interior transparency (medallion centers, mono icon
knockouts). A silhouette layer stacked between the glow and the badge in the
modal blocks the glow inside the badge footprint so it only halos around the
outside. The outer shape cannot be derived reliably from the source paths, so
this rasterises each badge, flood-fills the exterior, and keeps everything the
fill cannot reach (body + enclosed holes) as the silhouette.

Output: assets/badges/<key>_silhouette.svg (an <image> wrapping the raster so it
is served unchanged by both the dev /badge-art middleware and the prod route).

Requires: rsvg-convert, python3, Pillow. Run: pnpm run badges:silhouettes
"""

import base64
import io
import os
import re
import subprocess
import sys
from PIL import Image, ImageDraw

RES = 256
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, "..", "assets", "badges"))

SOURCE_RE = re.compile(r"^([a-z0-9-]+)(?:_mono|_\d+)?\.svg$")


def keys_and_sources():
    by_key = {}
    for name in sorted(os.listdir(ASSETS)):
        if name.endswith("_silhouette.svg") or name.endswith("_mono.svg"):
            continue
        m = SOURCE_RE.match(name)
        if not m:
            continue
        key = m.group(1)
        by_key.setdefault(key, [])
        by_key[key].append(name)
    resolved = {}
    for key, names in by_key.items():
        base = f"{key}.svg"
        resolved[key] = base if base in names else sorted(names)[0]
    return resolved


def render_alpha(src):
    png = subprocess.run(
        ["rsvg-convert", "-w", str(RES), "-h", str(RES), src],
        capture_output=True,
        check=True,
    ).stdout
    return Image.open(io.BytesIO(png)).convert("RGBA")


def silhouette(img):
    binary = img.getchannel("A").point(lambda v: 255 if v > 16 else 0).convert("L")
    padded = Image.new("L", (RES + 2, RES + 2), 0)
    padded.paste(binary, (1, 1))
    ImageDraw.floodfill(padded, (0, 0), 128, thresh=10)
    interior = padded.crop((1, 1, RES + 1, RES + 1)).point(lambda v: 0 if v == 128 else 255)
    out = Image.new("RGBA", (RES, RES), (0, 0, 0, 0))
    out.putalpha(interior)
    return out


def to_svg(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    data = base64.b64encode(buf.getvalue()).decode("ascii")
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        'width="32" height="32" viewBox="0 0 32 32">'
        f'<image width="32" height="32" href="data:image/png;base64,{data}" '
        f'xlink:href="data:image/png;base64,{data}"/></svg>'
    )


def main():
    sources = keys_and_sources()
    for key, src in sorted(sources.items()):
        img = render_alpha(os.path.join(ASSETS, src))
        svg = to_svg(silhouette(img))
        with open(os.path.join(ASSETS, f"{key}_silhouette.svg"), "w") as f:
            f.write(svg)
    print(f"wrote {len(sources)} silhouettes to {ASSETS}", file=sys.stderr)


if __name__ == "__main__":
    main()
