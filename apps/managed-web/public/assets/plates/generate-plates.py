"""Generates original orthographic "plate" illustrations for the Harbour
Electrical & Air Signature Slice.

Idiom follows the precedent already accepted in this repository
(apps/managed-web/public/examples/**): flat geometric composition drawn with PIL
primitives, 2x supersampled then downsampled for anti-aliasing. No photograph, no
traced or derived source image, no depiction of any person, no AI image model.

Palette is the Creative Contract's ink / paper / brass.
"""

import hashlib
import math
import os
import sys

from PIL import Image, ImageDraw

S = 2  # supersample factor

INK = (17, 24, 33)
INK_SOFT = (58, 71, 84)
PAPER = (243, 240, 233)
PAPER_DEEP = (231, 226, 214)
BRASS = (176, 124, 46)
RULE = (198, 191, 176)


def plate(width, height):
    image = Image.new("RGB", (width * S, height * S), PAPER)
    return image, ImageDraw.Draw(image)


def grid(draw, width, height, step=40):
    """Fine ruled drawing-sheet grid."""
    for x in range(0, width, step):
        draw.line([(x * S, 0), (x * S, height * S)], fill=RULE, width=1)
    for y in range(0, height, step):
        draw.line([(0, y * S), (width * S, y * S)], fill=RULE, width=1)


def rect(draw, box, outline=INK, width=2, fill=None):
    x0, y0, x1, y1 = box
    draw.rectangle(
        [x0 * S, y0 * S, x1 * S, y1 * S],
        outline=outline,
        width=width * S,
        fill=fill,
    )


def line(draw, points, fill=INK, width=2):
    draw.line([(x * S, y * S) for x, y in points], fill=fill, width=width * S)


def dot(draw, centre, radius, fill=BRASS):
    x, y = centre
    draw.ellipse(
        [(x - radius) * S, (y - radius) * S, (x + radius) * S, (y + radius) * S],
        fill=fill,
    )


def dimension(draw, x0, x1, y):
    """A drawn dimension line with end ticks."""
    line(draw, [(x0, y), (x1, y)], fill=INK_SOFT, width=1)
    for x in (x0, x1):
        line(draw, [(x, y - 5), (x, y + 5)], fill=INK_SOFT, width=1)


def save(image, width, height, path):
    out = image.resize((width, height), Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save(path, "PNG", optimize=True)
    digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
    print(f"{path}  {width}x{height}  {os.path.getsize(path)} bytes  {digest}")


def switchboard_plate(path, width=1600, height=1000):
    """Orthographic elevation of a residential switchboard."""
    image, draw = plate(width, height)
    grid(draw, width, height)

    bx0, by0, bx1, by1 = 380, 200, 1220, 800
    rect(draw, (bx0, by0, bx1, by1), fill=PAPER_DEEP)
    rect(draw, (bx0, by0, bx1, by1), width=3)
    rect(draw, (bx0 + 26, by0 + 26, bx1 - 26, by1 - 26), outline=INK_SOFT, width=1)

    # Two DIN rails of breakers.
    for row, ry in enumerate((by0 + 110, by0 + 330)):
        line(draw, [(bx0 + 60, ry + 62), (bx1 - 60, ry + 62)], fill=INK_SOFT, width=1)
        for index in range(12):
            x = bx0 + 74 + index * 62
            rect(draw, (x, ry, x + 44, ry + 124), width=2, fill=PAPER)
            # Toggle, alternating position so the plate reads as real hardware.
            up = (index + row) % 3 != 0
            ty = ry + (26 if up else 74)
            rect(draw, (x + 13, ty, x + 31, ty + 26), width=2, fill=INK if up else PAPER)
            line(draw, [(x + 8, ry + 108), (x + 36, ry + 108)], fill=INK_SOFT, width=1)

    # Main isolator, visually weightier.
    rect(draw, (bx0 + 60, by1 - 150, bx0 + 190, by1 - 60), width=3, fill=PAPER)
    line(draw, [(bx0 + 84, by1 - 128), (bx0 + 166, by1 - 128)], width=2)
    line(draw, [(bx0 + 84, by1 - 104), (bx0 + 166, by1 - 104)], width=2)
    line(draw, [(bx0 + 84, by1 - 80), (bx0 + 126, by1 - 80)], width=2)

    # Conductor run leaving the board.
    line(
        draw,
        [(bx1, by0 + 172), (bx1 + 120, by0 + 172), (bx1 + 120, by1 + 90), (250, by1 + 90)],
        fill=BRASS,
        width=3,
    )
    for node in ((bx1 + 120, by0 + 172), (bx1 + 120, by1 + 90), (250, by1 + 90)):
        dot(draw, node, 7)

    dimension(draw, bx0, bx1, by1 + 44)
    dimension(draw, 250, 330, 150)
    save(image, width, height, path)


def circuit_plan_plate(path, width=1600, height=1000):
    """Orthographic floor plan with a lighting circuit traced across it."""
    image, draw = plate(width, height)
    grid(draw, width, height)

    px0, py0, px1, py1 = 300, 190, 1300, 790
    rect(draw, (px0, py0, px1, py1), fill=PAPER_DEEP)
    rect(draw, (px0, py0, px1, py1), width=3)

    # Internal partitions, an irregular terrace plan rather than a grid of boxes.
    line(draw, [(px0 + 380, py0), (px0 + 380, py0 + 330)], width=3)
    line(draw, [(px0 + 380, py0 + 330), (px1, py0 + 330)], width=3)
    line(draw, [(px0 + 700, py0 + 330), (px0 + 700, py1)], width=3)

    # Door openings drawn as swing arcs, the convention a plan actually uses.
    for (hx, hy, direction) in (
        (px0 + 380, py0 + 210, 1),
        (px0 + 700, py0 + 470, 1),
        (px0 + 940, py0 + 330, -1),
    ):
        rect(draw, (hx - 4, hy, hx + 4, hy + 96), outline=PAPER_DEEP, width=1, fill=PAPER_DEEP)
        draw.arc(
            [(hx - 96) * S, (hy - 96 * (1 if direction > 0 else 0)) * S,
             (hx + 96) * S, (hy + 96 * (1 if direction > 0 else 2)) * S],
            start=0 if direction > 0 else 270,
            end=90 if direction > 0 else 360,
            fill=INK_SOFT,
            width=1 * S,
        )

    # Fixed joinery, so the plan reads as a home rather than an abstract shape.
    for box in ((px0 + 40, py0 + 40, px0 + 330, py0 + 110),
                (px1 - 300, py1 - 110, px1 - 40, py1 - 40)):
        rect(draw, box, outline=INK_SOFT, width=1)

    # The lighting circuit: one continuous run with junctions and drops.
    route = [
        (px0 + 60, py1 - 60), (px0 + 60, py0 + 170), (px0 + 200, py0 + 170),
        (px0 + 200, py0 + 430), (px0 + 540, py0 + 430), (px0 + 540, py0 + 160),
        (px0 + 900, py0 + 160), (px0 + 900, py0 + 560), (px1 - 80, py0 + 560),
    ]
    line(draw, route, fill=BRASS, width=3)
    for point in route[1:-1]:
        dot(draw, point, 8)

    # Fittings on drops.
    for x, y in ((px0 + 200, py0 + 300), (px0 + 540, py0 + 290), (px0 + 900, py0 + 380)):
        line(draw, [(x, y - 60), (x, y)], fill=BRASS, width=2)
        draw.ellipse(
            [(x - 15) * S, (y - 15) * S, (x + 15) * S, (y + 15) * S],
            outline=INK, width=2 * S, fill=PAPER,
        )
        line(draw, [(x - 10, y - 10), (x + 10, y + 10)], fill=INK, width=1)
        line(draw, [(x - 10, y + 10), (x + 10, y - 10)], fill=INK, width=1)

    dimension(draw, px0, px1, py1 + 50)
    dimension(draw, px0, px0 + 380, py0 - 40)
    save(image, width, height, path)


def facade_plate(path, width=1600, height=1000):
    """Orthographic elevation of a terrace facade with the supply run marked."""
    image, draw = plate(width, height)
    grid(draw, width, height)

    fx0, fy0, fx1, fy1 = 340, 180, 1260, 820
    rect(draw, (fx0, fy0, fx1, fy1), fill=PAPER_DEEP)
    rect(draw, (fx0, fy0, fx1, fy1), width=3)

    # Parapet.
    rect(draw, (fx0 - 24, fy0 - 40, fx1 + 24, fy0), width=3, fill=PAPER)

    # Windows, two floors, deliberately irregular rhythm.
    for floor, wy in enumerate((fy0 + 90, fy0 + 350)):
        widths = (150, 96, 150) if floor == 0 else (110, 110, 110)
        x = fx0 + 90
        for w in widths:
            rect(draw, (x, wy, x + w, wy + 190), width=2, fill=PAPER)
            line(draw, [(x + w / 2, wy), (x + w / 2, wy + 190)], fill=INK_SOFT, width=1)
            x += w + 96

    # Door.
    rect(draw, (fx0 + 90, fy1 - 230, fx0 + 216, fy1), width=3, fill=PAPER)
    dot(draw, (fx0 + 196, fy1 - 118), 5, fill=INK)

    # Supply run and meter box.
    rect(draw, (fx1 - 190, fy1 - 250, fx1 - 90, fy1 - 120), width=2, fill=PAPER)
    line(
        draw,
        [(fx1 - 140, fy1 - 250), (fx1 - 140, fy0 + 40), (fx0 + 420, fy0 + 40)],
        fill=BRASS,
        width=3,
    )
    for node in ((fx1 - 140, fy1 - 250), (fx1 - 140, fy0 + 40), (fx0 + 420, fy0 + 40)):
        dot(draw, node, 7)

    dimension(draw, fx0, fx1, fy1 + 50)
    save(image, width, height, path)


def detail_plate(path, width=1100, height=1100):
    """Square close detail: a terminal block with conductor terminations."""
    image, draw = plate(width, height)
    grid(draw, width, height, step=50)

    bx0, by0, bx1, by1 = 190, 380, 910, 640
    rect(draw, (bx0, by0, bx1, by1), fill=PAPER_DEEP)
    rect(draw, (bx0, by0, bx1, by1), width=3)

    # Eight terminals with screw heads.
    for index in range(8):
        x = bx0 + 34 + index * 84
        rect(draw, (x, by0 + 30, x + 58, by1 - 30), width=2, fill=PAPER)
        cx, cy = x + 29, by0 + 74
        draw.ellipse(
            [(cx - 17) * S, (cy - 17) * S, (cx + 17) * S, (cy + 17) * S],
            outline=INK, width=2 * S, fill=PAPER_DEEP,
        )
        line(draw, [(cx - 11, cy), (cx + 11, cy)], fill=INK, width=2)

        # Conductor entering from below, alternating brass and ink so the plate
        # distinguishes live runs from the earth bar.
        conductor = BRASS if index % 3 != 2 else INK_SOFT
        line(draw, [(cx, by1 - 30), (cx, by1 + 120 + (index % 3) * 46)], fill=conductor, width=3)
        dot(draw, (cx, by1 + 120 + (index % 3) * 46), 7, fill=conductor)

    # Feed entering the block from the left.
    line(draw, [(60, by0 - 120), (60, (by0 + by1) // 2), (bx0, (by0 + by1) // 2)], fill=BRASS, width=4)
    dot(draw, (60, by0 - 120), 9)

    dimension(draw, bx0, bx1, by0 - 60)
    dimension(draw, bx0, bx0 + 84, by1 + 300)
    save(image, width, height, path)


if __name__ == "__main__":
    root = sys.argv[1]
    switchboard_plate(f"{root}/plates/switchboard.png")
    circuit_plan_plate(f"{root}/plates/circuit-plan.png")
    facade_plate(f"{root}/plates/facade.png")
    detail_plate(f"{root}/plates/junction-detail.png")
