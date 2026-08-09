#!/usr/bin/env python3
"""Generate Ayat Flow app icons (pure Python, no PIL required)."""
import math
import os
import struct
import sys
import zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "assets")


def bez(p0, p1, p2, t):
    u = 1.0 - t
    return (u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1])


def solve_t(p0, p1, p2, target_y):
    lo, hi = 0.0, 1.0
    for _ in range(24):
        mid = (lo + hi) / 2
        if bez(p0, p1, p2, mid)[1] < target_y:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


# ---- Book glyph geometry (normalized space, center 0.5 / 0.54) ----
SPINE_L = 0.488
SPINE_R = 0.512
TOP_Y = 0.21
CORNER_Y = 0.37
CORNER_Y2 = 0.71
BOTTOM_Y = 0.87

SEG_TOP = ((SPINE_L, TOP_Y), (0.34, 0.215), (0.20, CORNER_Y))
SEG_EDGE = ((0.20, CORNER_Y), (0.163, MID_Y := 0.54), (0.20, CORNER_Y2))
SEG_BOTTOM = ((0.20, CORNER_Y2), (0.34, 0.865), (SPINE_L, BOTTOM_Y))


def left_x(y):
    if y < TOP_Y or y > BOTTOM_Y:
        return None
    if y < CORNER_Y:
        return bez(*SEG_TOP, solve_t(*SEG_TOP, y))[0]
    if y <= CORNER_Y2:
        return bez(*SEG_EDGE, solve_t(*SEG_EDGE, y))[0]
    return bez(*SEG_BOTTOM, solve_t(*SEG_BOTTOM, y))[0]


TOP = (0x1B / 255.0, 0xA3 / 255.0, 0x92 / 255.0)
BOTTOM = (0x0A / 255.0, 0x5C / 255.0, 0x52 / 255.0)
WHITE = (1.0, 1.0, 1.0)


def build_left_x_table(rows):
    """left_x for each supersampled row y (normalized)."""
    table = []
    for r in range(rows):
        y = (r + 0.5) / rows
        table.append(left_x(y))
    return table


def write_png(path, size, scale, shift_y, transparent_bg, ss):
    rows = size * ss
    table = build_left_x_table(rows)
    y_bot = TOP_Y * rows
    y_top = BOTTOM_Y * rows

    out_rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            pr = pg = pb = pa = 0.0
            for dy in range(ss):
                for dx in range(ss):
                    sx = x * ss + dx + 0.5
                    sy = y * ss + dy + 0.5
                    # glyph-space coords (normalized), book center (0.5, 0.54)
                    gx = 0.5 + (sx / rows - 0.5) / scale
                    gy = 0.54 + (sy / rows - 0.5) / scale - shift_y / scale
                    row_idx = int(gy * rows)
                    lx = table[row_idx] if y_bot <= row_idx <= y_top else None
                    in_page = False
                    if lx is not None:
                        if SPINE_L >= gx >= lx:
                            in_page = True
                        elif SPINE_R <= gx <= 1.0 - lx:
                            in_page = True
                    if in_page:
                        r = g = b = 1.0
                        a = 1.0
                    elif transparent_bg:
                        r = g = b = 0.0
                        a = 0.0
                    else:
                        px = sx / rows
                        py = sy / rows
                        r = lerp_c(TOP[0], BOTTOM[0], py)
                        g = lerp_c(TOP[1], BOTTOM[1], py)
                        b = lerp_c(TOP[2], BOTTOM[2], py)
                        d = math.hypot(px - 0.5, py - 0.27)
                        glow = max(0.0, 1.0 - d / 0.58)
                        glow2 = 0.10 * glow * glow
                        r += (1.0 - r) * glow2
                        g += (1.0 - g) * glow2
                        b += (1.0 - b) * glow2
                        a = 1.0
                    pr += r * a
                    pg += g * a
                    pb += b * a
                    pa += a
            n = ss * ss
            pa /= n
            if pa > 0:
                pr /= pa * n
                pg /= pa * n
                pb /= pa * n
            else:
                pr = pg = pb = 0.0
            row += bytes((
                int(max(0, min(255, pr * 255))),
                int(max(0, min(255, pg * 255))),
                int(max(0, min(255, pb * 255))),
                int(max(0, min(255, pa * 255))),
            ))
        out_rows.append(bytes(row))
        if y % 128 == 0:
            print(f"  {os.path.basename(path)}: {y}/{size}", flush=True)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    raw = b"".join(b"\x00" + r for r in out_rows)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    print(f"wrote {path} ({size}x{size})")


def lerp_c(a, b, t):
    return a + (b - a) * t


def main():
    os.makedirs(OUT, exist_ok=True)
    write_png(os.path.join(OUT, "icon.png"), 1024, 1.0, 0.0, False, 3)
    write_png(os.path.join(OUT, "adaptive-icon.png"), 1024, 0.72, 0.02, True, 3)
    write_png(os.path.join(OUT, "splash-icon.png"), 512, 0.62, 0.02, True, 4)
    write_png(os.path.join(OUT, "favicon.png"), 48, 1.0, 0.0, False, 4)
    print("done")


if __name__ == "__main__":
    main()
