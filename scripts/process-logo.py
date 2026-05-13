#!/usr/bin/env python3
"""Process the SecPro source PNG into all required logo variants.

Source: /Users/matej/Desktop/Projects/secpro/output-onlinepngtools (1).png
        — cyan octagon "S" mark + "SecPro" wordmark on transparent background.

Outputs (all into public/img/):
  - secpro-logo-s.png         — cyan S octagon, 256×256 (default, for light backgrounds)
  - secpro-logo-s-white.png   — white-inverted S octagon, 256×256 (for dark headers)
  - secpro-logo-full.png      — full cyan wordmark, max 1200 wide
  - favicon-32.png            — 32×32 favicon from cyan S
  - favicon-16.png            — 16×16 favicon from cyan S
  - apple-touch-icon.png      — 180×180 from cyan S (on cyan-tinted square bg for iOS)
  - email-logo.png            — 64×64 white S on transparent (for base64 inlining in emails)
"""
import os
import sys
from PIL import Image, ImageOps

ROOT = "/Users/matej/Desktop/Projects/secpro"
SRC = os.path.join(ROOT, "output-onlinepngtools (1).png")
OUT = os.path.join(ROOT, "public", "img")
os.makedirs(OUT, exist_ok=True)


def detect_bbox_columns(img):
    """Find the column ranges of distinct non-transparent regions.

    The source has the S-octagon on the left followed by a gap, then "SecPro" text.
    We split by detecting columns where alpha is fully zero for a run of pixels.
    """
    w, h = img.size
    alpha = img.split()[-1]
    col_has_content = []
    for x in range(w):
        # any pixel in this column non-transparent?
        col = [alpha.getpixel((x, y)) for y in range(0, h, 4)]  # sample every 4 rows
        col_has_content.append(any(a > 16 for a in col))
    # find runs
    runs = []  # list of (start, end) where content is present
    in_run = False
    s = 0
    for x, c in enumerate(col_has_content):
        if c and not in_run:
            s = x
            in_run = True
        elif not c and in_run:
            runs.append((s, x - 1))
            in_run = False
    if in_run:
        runs.append((s, w - 1))
    # filter tiny noise runs
    runs = [(a, b) for a, b in runs if b - a > 20]
    return runs


def crop_left_block(src_path):
    img = Image.open(src_path).convert("RGBA")
    print(f"Source: {img.size}")
    runs = detect_bbox_columns(img)
    print(f"Detected content runs (columns): {runs}")
    # left-most run = the S octagon
    if not runs:
        raise SystemExit("Could not detect any non-transparent content")
    s_start, s_end = runs[0]
    # find vertical bbox within those columns
    s_img = img.crop((s_start, 0, s_end + 1, img.height))
    s_bbox = s_img.getbbox()  # (left, top, right, bottom) of non-transparent
    if s_bbox is None:
        raise SystemExit("S octagon has no opaque pixels")
    cropped = s_img.crop(s_bbox)
    # pad to square
    side = max(cropped.size)
    pad_w = (side - cropped.width) // 2
    pad_h = (side - cropped.height) // 2
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(cropped, (pad_w, pad_h))
    print(f"S-only cropped to {cropped.size}, squared to {square.size}")
    return square, img


def white_invert(rgba_img):
    """Replace all non-transparent pixel colors with white, preserving alpha."""
    out = rgba_img.copy()
    pixels = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a > 0:
                pixels[x, y] = (255, 255, 255, a)
    return out


def main():
    if not os.path.exists(SRC):
        sys.exit(f"Missing source: {SRC}")

    # 1) S-only crop + square pad
    s_square, full = crop_left_block(SRC)

    # 2) Resize cyan S to 256×256, save
    s256 = s_square.resize((256, 256), Image.LANCZOS)
    s256.save(os.path.join(OUT, "secpro-logo-s.png"), optimize=True)
    print("  ✓ secpro-logo-s.png (256×256 cyan)")

    # 3) White variant
    s_white = white_invert(s256)
    s_white.save(os.path.join(OUT, "secpro-logo-s-white.png"), optimize=True)
    print("  ✓ secpro-logo-s-white.png (256×256 white)")

    # 4) Full wordmark — just resize the full source proportionally to fit width 1200
    target_w = 1200
    if full.width > target_w:
        ratio = target_w / full.width
        new_size = (target_w, int(full.height * ratio))
        full_resized = full.resize(new_size, Image.LANCZOS)
    else:
        full_resized = full
    # Crop transparent margins on the full version too
    fbb = full_resized.getbbox()
    if fbb:
        full_resized = full_resized.crop(fbb)
    full_resized.save(os.path.join(OUT, "secpro-logo-full.png"), optimize=True)
    print(f"  ✓ secpro-logo-full.png ({full_resized.size})")

    # 5) Favicons
    for size in (16, 32, 48):
        s_sized = s_square.resize((size, size), Image.LANCZOS)
        s_sized.save(os.path.join(OUT, f"favicon-{size}.png"), optimize=True)
    print("  ✓ favicon-16/32/48 .png")

    # 6) Apple touch icon — 180×180 with light background for iOS home screen
    apple_bg = Image.new("RGBA", (180, 180), (255, 255, 255, 255))
    s180 = s_square.resize((130, 130), Image.LANCZOS)
    apple_bg.paste(s180, (25, 25), s180)
    apple_bg.save(os.path.join(OUT, "apple-touch-icon.png"), optimize=True)
    print("  ✓ apple-touch-icon.png (180×180)")

    # 7) Email logo (white, small) — for base64 inlining in reset emails
    email_logo = white_invert(s_square.resize((64, 64), Image.LANCZOS))
    email_logo.save(os.path.join(OUT, "email-logo.png"), optimize=True)
    print(f"  ✓ email-logo.png (64×64 white)")

    # 8) Also generate true .ico (multi-resolution)
    try:
        # PIL can save .ico from RGBA, using sizes argument
        s256.save(os.path.join(OUT, "favicon.ico"), format="ICO",
                  sizes=[(16, 16), (32, 32), (48, 48)])
        print("  ✓ favicon.ico (multi-res)")
    except Exception as e:
        print(f"  ⚠ favicon.ico not generated: {e}")

    print("\nAll logo variants written to", OUT)


if __name__ == "__main__":
    main()
