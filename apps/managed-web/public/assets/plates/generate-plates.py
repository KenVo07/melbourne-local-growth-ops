"""Generates original orthographic "plate" illustrations for the Harbour
Electrical & Air client experience.

Idiom follows the precedent already accepted in this repository
(apps/managed-web/public/examples/**): flat geometric composition drawn with PIL
primitives, 2x supersampled then downsampled for anti-aliasing. No photograph, no
traced or derived source image, no depiction of any person, no AI image model.

Palette is the Creative Contract's ink / paper / brass.

Lettering convention: these plates carry no rendered text. Where a real drawing
would letter a note, the plate draws the label *rule* it would sit on. That keeps
the illustrations honest — they never appear to state a fact, a measurement or a
certification that nobody has verified — and it keeps them legible at the sizes
the layout actually crops them to. All meaning reaches the reader through the
page's real HTML text: the alt text, the caption and the surrounding copy.

Run: python3 generate-plates.py <public-dir>
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


def dashed(draw, start, end, fill=INK_SOFT, width=1, dash=14, gap=10):
    """A hidden-detail line, the convention for what sits behind the cut."""
    (x0, y0), (x1, y1) = start, end
    span = math.hypot(x1 - x0, y1 - y0)
    if span == 0:
        return
    ux, uy = (x1 - x0) / span, (y1 - y0) / span
    travelled = 0.0
    while travelled < span:
        run = min(dash, span - travelled)
        line(
            draw,
            [
                (x0 + ux * travelled, y0 + uy * travelled),
                (x0 + ux * (travelled + run), y0 + uy * (travelled + run)),
            ],
            fill=fill,
            width=width,
        )
        travelled += dash + gap


def dot(draw, centre, radius, fill=BRASS):
    x, y = centre
    draw.ellipse(
        [(x - radius) * S, (y - radius) * S, (x + radius) * S, (y + radius) * S],
        fill=fill,
    )


def ring(draw, centre, radius, outline=INK, width=2, fill=PAPER):
    x, y = centre
    draw.ellipse(
        [(x - radius) * S, (y - radius) * S, (x + radius) * S, (y + radius) * S],
        outline=outline,
        width=width * S,
        fill=fill,
    )


def hatch(draw, box, spacing=18, fill=RULE, width=1):
    """Diagonal hatch: the convention for material cut by the section plane."""
    x0, y0, x1, y1 = box
    extent = int((x1 - x0) + (y1 - y0))
    for offset in range(0, extent, spacing):
        ax, ay = x0 + offset, y0
        bx, by = x0, y0 + offset
        # Clip the 45° line to the box.
        if ax > x1:
            ay += ax - x1
            ax = x1
        if by > y1:
            bx += by - y1
            by = y1
        if ay > y1 or bx > x1:
            continue
        line(draw, [(ax, ay), (bx, by)], fill=fill, width=width)


def dimension(draw, x0, x1, y):
    """A drawn dimension line with end ticks."""
    line(draw, [(x0, y), (x1, y)], fill=INK_SOFT, width=1)
    for x in (x0, x1):
        line(draw, [(x, y - 5), (x, y + 5)], fill=INK_SOFT, width=1)


def dim_chain(draw, stops, y):
    """A chain of running dimensions across one edge."""
    for start, end in zip(stops, stops[1:]):
        dimension(draw, start, end, y)


def vdimension(draw, y0, y1, x):
    line(draw, [(x, y0), (x, y1)], fill=INK_SOFT, width=1)
    for y in (y0, y1):
        line(draw, [(x - 5, y), (x + 5, y)], fill=INK_SOFT, width=1)


def label_rule(draw, x, y, length=86, fill=INK_SOFT):
    """The rule a lettered note would sit on. Deliberately unlettered."""
    line(draw, [(x, y), (x + length, y)], fill=fill, width=1)


def leader(draw, target, elbow, run=110, flip=False):
    """A leader from a drawn feature out to an (unlettered) label rule."""
    tx, ty = target
    ex, ey = elbow
    end = ex - run if flip else ex + run
    line(draw, [(tx, ty), (ex, ey)], fill=INK_SOFT, width=1)
    line(draw, [(ex, ey), (end, ey)], fill=INK_SOFT, width=1)
    dot(draw, (tx, ty), 4, fill=INK_SOFT)
    label_rule(draw, min(end, ex), ey - 12, abs(end - ex))


def title_block(draw, width, height, rows=4):
    """A drawing-sheet title block: ruled fields, no lettering."""
    bw, bh = 320, 26 * rows + 26
    x0, y0 = width - bw - 40, height - bh - 34
    rect(draw, (x0, y0, x0 + bw, y0 + bh), outline=INK_SOFT, width=1, fill=PAPER)
    for index in range(rows):
        y = y0 + 26 + index * 26
        if index:
            line(draw, [(x0, y - 13), (x0 + bw, y - 13)], fill=RULE, width=1)
        label_rule(draw, x0 + 16, y, 96 if index % 2 else 128)
        label_rule(draw, x0 + 190, y, 108 if index % 2 else 74)


def border(draw, width, height, inset=40):
    """The sheet border every plate shares, so the set reads as one drawing set."""
    rect(draw, (inset, inset, width - inset, height - inset), outline=INK_SOFT, width=1)


def save(image, width, height, path):
    out = image.resize((width, height), Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save(path, "PNG", optimize=True)
    digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
    print(f"{path}  {width}x{height}  {os.path.getsize(path)} bytes  {digest}")


# --------------------------------------------------------------------------
# Landscape plates, 1600x1000.
# --------------------------------------------------------------------------


def switchboard_plate(path, width=1600, height=1000):
    """Orthographic elevation of a residential switchboard."""
    image, draw = plate(width, height)
    grid(draw, width, height)
    border(draw, width, height)

    bx0, by0, bx1, by1 = 380, 180, 1220, 800
    # Wall the board is fixed to, shown cut.
    hatch(draw, (bx0 - 90, by0 - 60, bx0 - 30, by1 + 60), spacing=14)
    line(draw, [(bx0 - 90, by0 - 60), (bx0 - 90, by1 + 60)], fill=INK_SOFT, width=1)
    line(draw, [(bx0 - 30, by0 - 60), (bx0 - 30, by1 + 60)], fill=INK_SOFT, width=1)

    rect(draw, (bx0, by0, bx1, by1), fill=PAPER_DEEP)
    rect(draw, (bx0, by0, bx1, by1), width=3)
    rect(draw, (bx0 + 26, by0 + 26, bx1 - 26, by1 - 26), outline=INK_SOFT, width=1)

    # Two DIN rails of breakers.
    for row, ry in enumerate((by0 + 96, by0 + 292)):
        line(draw, [(bx0 + 60, ry + 62), (bx1 - 60, ry + 62)], fill=INK_SOFT, width=1)
        for index in range(12):
            x = bx0 + 74 + index * 62
            rect(draw, (x, ry, x + 44, ry + 124), width=2, fill=PAPER)
            # Toggle, alternating position so the plate reads as real hardware.
            up = (index + row) % 3 != 0
            ty = ry + (26 if up else 74)
            rect(draw, (x + 13, ty, x + 31, ty + 26), width=2, fill=INK if up else PAPER)
            line(draw, [(x + 8, ry + 108), (x + 36, ry + 108)], fill=INK_SOFT, width=1)
            # The way's circuit-label field, ruled and unlettered.
            label_rule(draw, x + 4, ry - 14, 36, fill=RULE)

    # Neutral bar and earth bar: the two terminal strips a real board carries.
    for bar_index, bar_y in enumerate((by0 + 470, by0 + 528)):
        rect(draw, (bx0 + 74, bar_y, bx1 - 74, bar_y + 30), width=2, fill=PAPER)
        for index in range(18):
            sx = bx0 + 96 + index * 38
            line(draw, [(sx, bar_y + 6), (sx, bar_y + 24)], fill=INK_SOFT, width=1)
            line(
                draw,
                [(sx, bar_y + 30), (sx, bar_y + 30 + (18 if bar_index else 34))],
                fill=INK_SOFT if bar_index else BRASS,
                width=1,
            )

    # Main isolator, visually weightier.
    rect(draw, (bx0 + 60, by1 - 150, bx0 + 190, by1 - 60), width=3, fill=PAPER)
    line(draw, [(bx0 + 84, by1 - 128), (bx0 + 166, by1 - 128)], width=2)
    line(draw, [(bx0 + 84, by1 - 104), (bx0 + 166, by1 - 104)], width=2)
    line(draw, [(bx0 + 84, by1 - 80), (bx0 + 126, by1 - 80)], width=2)

    # Residual-current device group, ganged under one test bar.
    rect(draw, (bx0 + 240, by1 - 150, bx0 + 470, by1 - 60), width=2, fill=PAPER)
    for index in range(3):
        x = bx0 + 262 + index * 72
        rect(draw, (x, by1 - 132, x + 46, by1 - 78), width=2, fill=PAPER_DEEP)
    line(draw, [(bx0 + 240, by1 - 168), (bx0 + 470, by1 - 168)], fill=BRASS, width=2)

    # Conductor run leaving the board.
    line(
        draw,
        [(bx1, by0 + 158), (bx1 + 120, by0 + 158), (bx1 + 120, by1 + 90), (250, by1 + 90)],
        fill=BRASS,
        width=3,
    )
    for node in ((bx1 + 120, by0 + 158), (bx1 + 120, by1 + 90), (250, by1 + 90)):
        dot(draw, node, 7)

    leader(draw, (bx0 + 96, by0 + 158), (bx0 - 140, by0 + 60), run=120, flip=True)
    leader(draw, (bx0 + 300, by0 + 485), (bx1 + 60, by0 + 430), run=120)
    leader(draw, (bx0 + 125, by1 - 105), (bx0 - 140, by1 - 20), run=120, flip=True)

    dim_chain(draw, [bx0, bx0 + 280, bx0 + 560, bx1], by1 + 44)
    vdimension(draw, by0, by1, bx1 + 190)
    title_block(draw, width, height)
    save(image, width, height, path)


def circuit_plan_plate(path, width=1600, height=1000):
    """Orthographic floor plan with a lighting circuit traced across it."""
    image, draw = plate(width, height)
    grid(draw, width, height)
    border(draw, width, height)

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
        hatch(draw, box, spacing=22)

    # Floor finish change, hatched, so the plan has a second texture.
    hatch(draw, (px0 + 700, py0 + 330, px1, py1), spacing=34, fill=RULE)

    # Switch positions, drawn on the wall lines they are actually fixed to.
    for sx, sy in ((px0 + 356, py0 + 250), (px0 + 676, py0 + 510), (px0 + 916, py0 + 306)):
        ring(draw, (sx, sy), 11, outline=INK, width=2)
        line(draw, [(sx, sy), (sx + 18, sy - 18)], fill=INK, width=2)

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
        ring(draw, (x, y), 15)
        line(draw, [(x - 10, y - 10), (x + 10, y + 10)], fill=INK, width=1)
        line(draw, [(x - 10, y + 10), (x + 10, y - 10)], fill=INK, width=1)

    # Where the run continues beyond this sheet.
    dashed(draw, (px1 - 80, py0 + 560), (px1 + 120, py0 + 560), fill=BRASS)

    leader(draw, (px0 + 540, py0 + 430), (px0 + 540, py0 - 60), run=120)
    leader(draw, (px0 + 900, py0 + 380), (px1 + 70, py0 + 300), run=110)

    dim_chain(draw, [px0, px0 + 380, px0 + 700, px1], py1 + 50)
    vdimension(draw, py0, py0 + 330, px0 - 60)
    vdimension(draw, py0 + 330, py1, px0 - 60)
    title_block(draw, width, height)
    save(image, width, height, path)


def facade_plate(path, width=1600, height=1000):
    """Orthographic elevation of a terrace facade with the supply run marked."""
    image, draw = plate(width, height)
    grid(draw, width, height)
    border(draw, width, height)

    fx0, fy0, fx1, fy1 = 340, 180, 1260, 820
    rect(draw, (fx0, fy0, fx1, fy1), fill=PAPER_DEEP)
    rect(draw, (fx0, fy0, fx1, fy1), width=3)

    # Brick course lines: the facade needs a surface, not a flat fill.
    for course in range(fy0 + 40, fy1, 40):
        line(draw, [(fx0, course), (fx1, course)], fill=RULE, width=1)

    # Parapet.
    rect(draw, (fx0 - 24, fy0 - 40, fx1 + 24, fy0), width=3, fill=PAPER)
    line(draw, [(fx0 - 24, fy0 - 22), (fx1 + 24, fy0 - 22)], fill=INK_SOFT, width=1)

    # String course between floors.
    rect(draw, (fx0 - 12, fy0 + 300, fx1 + 12, fy0 + 322), width=2, fill=PAPER)

    # Windows, two floors, deliberately irregular rhythm.
    for floor, wy in enumerate((fy0 + 90, fy0 + 380)):
        widths = (150, 96, 150) if floor == 0 else (110, 110, 110)
        x = fx0 + 90
        for w in widths:
            rect(draw, (x, wy, x + w, wy + 180), width=2, fill=PAPER)
            line(draw, [(x + w / 2, wy), (x + w / 2, wy + 180)], fill=INK_SOFT, width=1)
            # Sill and head, so the openings have depth.
            rect(draw, (x - 10, wy + 180, x + w + 10, wy + 196), width=1, fill=PAPER_DEEP)
            line(draw, [(x - 10, wy - 8), (x + w + 10, wy - 8)], fill=INK_SOFT, width=1)
            x += w + 96

    # Door.
    rect(draw, (fx0 + 90, fy1 - 230, fx0 + 216, fy1), width=3, fill=PAPER)
    rect(draw, (fx0 + 104, fy1 - 214, fx0 + 202, fy1 - 128), width=1, fill=PAPER_DEEP)
    dot(draw, (fx0 + 196, fy1 - 118), 5, fill=INK)

    # Supply run and meter box.
    rect(draw, (fx1 - 190, fy1 - 250, fx1 - 90, fy1 - 120), width=2, fill=PAPER)
    rect(draw, (fx1 - 176, fy1 - 236, fx1 - 104, fy1 - 176), width=1, fill=PAPER_DEEP)
    line(
        draw,
        [(fx1 - 140, fy1 - 250), (fx1 - 140, fy0 + 40), (fx0 + 420, fy0 + 40)],
        fill=BRASS,
        width=3,
    )
    for node in ((fx1 - 140, fy1 - 250), (fx1 - 140, fy0 + 40), (fx0 + 420, fy0 + 40)):
        dot(draw, node, 7)
    # Where the run enters the fabric and is no longer visible.
    dashed(draw, (fx0 + 420, fy0 + 40), (fx0 + 420, fy0 + 260), fill=BRASS)

    # Ground line, drawn heavier than the building, as an elevation does.
    line(draw, [(fx0 - 160, fy1), (fx1 + 160, fy1)], width=4)
    hatch(draw, (fx0 - 160, fy1, fx1 + 160, fy1 + 34), spacing=20)

    leader(draw, (fx1 - 140, fy1 - 250), (fx1 + 90, fy1 - 320), run=100)
    leader(draw, (fx0 + 420, fy0 + 40), (fx0 + 420, fy0 - 70), run=120)

    dim_chain(draw, [fx0, fx0 + 336, fx0 + 672, fx1], fy1 + 62)
    vdimension(draw, fy0 - 40, fy1, fx0 - 80)
    title_block(draw, width, height)
    save(image, width, height, path)


def wall_section_plate(path, width=1600, height=1000):
    """Vertical section through a stud wall showing the cable chase."""
    image, draw = plate(width, height)
    grid(draw, width, height)
    border(draw, width, height)

    wx0, wy0, wx1, wy1 = 400, 150, 1290, 850

    # Plates top and bottom, cut and hatched.
    for box in ((wx0, wy0, wx1, wy0 + 46), (wx0, wy1 - 46, wx1, wy1)):
        rect(draw, box, fill=PAPER_DEEP)
        rect(draw, box, width=3)
        hatch(draw, box, spacing=16)

    # Studs at centres, each cut.
    centres = [wx0 + 60 + index * 150 for index in range(6)]
    for cx in centres:
        box = (cx - 26, wy0 + 46, cx + 26, wy1 - 46)
        rect(draw, box, fill=PAPER_DEEP)
        rect(draw, box, width=2)
        hatch(draw, box, spacing=16)

    # Noggin row.
    noggin_y = wy0 + 330
    for left, right in zip(centres, centres[1:]):
        box = (left + 26, noggin_y, right - 26, noggin_y + 44)
        rect(draw, box, fill=PAPER_DEEP)
        rect(draw, box, width=2)
        hatch(draw, box, spacing=16)

    # Lining board on the near face, shown thin.
    rect(draw, (wx0 - 34, wy0, wx0 - 8, wy1), width=2, fill=PAPER_DEEP)

    # The cable chase: drilled through the studs at a consistent height.
    chase_y = wy0 + 380
    for cx in centres:
        ring(draw, (cx, chase_y), 15, outline=INK, width=2, fill=PAPER)
    line(draw, [(wx0 - 60, chase_y), (wx1 + 80, chase_y)], fill=BRASS, width=4)

    # Three outlet positions taken off the run.
    for index, cx in enumerate((centres[1], centres[3], centres[4])):
        drop_y = chase_y + 110 + (index % 2) * 56
        line(draw, [(cx + 40, chase_y), (cx + 40, drop_y)], fill=BRASS, width=3)
        rect(draw, (cx + 12, drop_y, cx + 96, drop_y + 60), width=2, fill=PAPER)
        for pin in range(2):
            dot(draw, (cx + 38 + pin * 32, drop_y + 30), 6, fill=INK_SOFT)
        leader(draw, (cx + 54, drop_y + 60), (cx + 54, wy1 + 60), run=90)

    # Insulation batt in one bay, so the section is not uniformly empty.
    bay = (centres[4] + 26, wy0 + 46, centres[5] - 26, noggin_y)
    for wave_y in range(int(bay[1]) + 24, int(bay[3]), 30):
        points = []
        for step in range(0, int(bay[2] - bay[0]) + 1, 12):
            points.append((bay[0] + step, wave_y + math.sin(step / 18) * 7))
        line(draw, points, fill=RULE, width=1)

    dim_chain(draw, centres, wy1 + 130)
    vdimension(draw, wy0, chase_y, wx0 - 110)
    vdimension(draw, chase_y, wy1, wx0 - 110)
    title_block(draw, width, height)
    save(image, width, height, path)


def schematic_plate(path, width=1600, height=1000):
    """Single-line schematic: supply, main switch, busbar, final circuits."""
    image, draw = plate(width, height)
    grid(draw, width, height)
    border(draw, width, height)

    # Incoming supply from the left.
    supply_y = 250
    line(draw, [(150, supply_y), (330, supply_y)], fill=BRASS, width=4)
    dot(draw, (150, supply_y), 10)

    # Meter.
    ring(draw, (390, supply_y), 46, outline=INK, width=3)
    line(draw, [(366, supply_y + 18), (414, supply_y - 18)], fill=INK, width=2)
    line(draw, [(436, supply_y), (520, supply_y)], fill=BRASS, width=4)

    # Main switch, drawn open-bladed as a single-line diagram does.
    rect(draw, (520, supply_y - 54, 640, supply_y + 54), width=3, fill=PAPER)
    line(draw, [(548, supply_y + 30), (612, supply_y - 30)], fill=INK, width=3)
    dot(draw, (548, supply_y + 30), 6, fill=INK)
    ring(draw, (612, supply_y - 30), 6, outline=INK, width=2)

    # Busbar.
    bus_y = supply_y + 170
    line(draw, [(640, supply_y), (760, supply_y), (760, bus_y)], fill=BRASS, width=4)
    line(draw, [(280, bus_y), (1500, bus_y)], fill=BRASS, width=5)
    dot(draw, (760, bus_y), 9)

    # Eight final circuits dropping off the bar.
    columns = [300 + index * 160 for index in range(8)]
    for index, cx in enumerate(columns):
        line(draw, [(cx, bus_y), (cx, bus_y + 90)], fill=INK_SOFT, width=2)
        dot(draw, (cx, bus_y), 7, fill=BRASS)

        # Protective device.
        rect(draw, (cx - 34, bus_y + 90, cx + 34, bus_y + 178), width=2, fill=PAPER)
        line(draw, [(cx - 16, bus_y + 152), (cx + 16, bus_y + 116)], fill=INK, width=2)
        if index % 3 == 0:
            # Residual-current type: a second, weightier body.
            rect(draw, (cx - 34, bus_y + 178, cx + 34, bus_y + 236), width=2, fill=PAPER_DEEP)
            line(draw, [(cx - 18, bus_y + 207), (cx + 18, bus_y + 207)], fill=INK, width=2)
            tail = bus_y + 236
        else:
            tail = bus_y + 178

        line(draw, [(cx, tail), (cx, tail + 110)], fill=INK_SOFT, width=2)

        # Terminating symbol, varied by circuit type.
        kind = index % 4
        end = (cx, tail + 110)
        if kind == 0:
            ring(draw, end, 18)
            line(draw, [(cx - 12, tail + 98), (cx + 12, tail + 122)], fill=INK, width=1)
            line(draw, [(cx - 12, tail + 122), (cx + 12, tail + 98)], fill=INK, width=1)
        elif kind == 1:
            rect(draw, (cx - 22, tail + 96, cx + 22, tail + 138), width=2, fill=PAPER)
            dot(draw, (cx - 9, tail + 117), 5, fill=INK_SOFT)
            dot(draw, (cx + 9, tail + 117), 5, fill=INK_SOFT)
        elif kind == 2:
            line(draw, [(cx - 24, tail + 110), (cx + 24, tail + 110)], fill=INK, width=3)
            line(draw, [(cx - 14, tail + 124), (cx + 14, tail + 124)], fill=INK, width=2)
            line(draw, [(cx - 6, tail + 138), (cx + 6, tail + 138)], fill=INK, width=2)
        else:
            ring(draw, end, 18)
            line(draw, [(cx, tail + 92), (cx, tail + 128)], fill=INK, width=2)

        label_rule(draw, cx - 40, bus_y + 62, 80, fill=RULE)

    # Earth reference at the end of the bar, clear of the last circuit.
    line(draw, [(1500, bus_y), (1500, bus_y + 70)], fill=INK, width=3)
    for index, half in enumerate((34, 22, 10)):
        line(
            draw,
            [(1500 - half, bus_y + 70 + index * 14), (1500 + half, bus_y + 70 + index * 14)],
            fill=INK,
            width=2,
        )

    leader(draw, (580, supply_y), (580, 120), run=120)
    leader(draw, (1000, bus_y), (1000, bus_y - 90), run=120)

    title_block(draw, width, height)
    save(image, width, height, path)


def roof_space_plate(path, width=1600, height=1000):
    """Section through a roof void with the run carried over the ceiling."""
    image, draw = plate(width, height)
    grid(draw, width, height)
    border(draw, width, height)

    apex = (800, 170)
    left, right = (250, 620), (1350, 620)

    # Rafters both sides.
    line(draw, [left, apex, right], width=4)
    line(draw, [(left[0] + 46, left[1]), (apex[0], apex[1] + 40), (right[0] - 46, right[1])], fill=INK_SOFT, width=2)

    # Ceiling joists, cut.
    ceiling_y = 620
    rect(draw, (left[0] + 20, ceiling_y, right[0] - 20, ceiling_y + 34), fill=PAPER_DEEP)
    rect(draw, (left[0] + 20, ceiling_y, right[0] - 20, ceiling_y + 34), width=3)
    for jx in range(left[0] + 70, right[0] - 40, 110):
        rect(draw, (jx, ceiling_y, jx + 26, ceiling_y + 34), width=1, fill=PAPER_DEEP)
        hatch(draw, (jx, ceiling_y, jx + 26, ceiling_y + 34), spacing=12)

    # Collar ties and struts, so the void has structure.
    line(draw, [(560, 400), (1040, 400)], width=3)
    line(draw, [(660, 400), (660, ceiling_y)], fill=INK_SOFT, width=2)
    line(draw, [(940, 400), (940, ceiling_y)], fill=INK_SOFT, width=2)

    # Battens on the near rafter, drawn as short ticks.
    for step in range(1, 12):
        t = step / 12
        bx = left[0] + (apex[0] - left[0]) * t
        by = left[1] + (apex[1] - left[1]) * t
        line(draw, [(bx - 8, by + 14), (bx + 8, by + 2)], fill=RULE, width=1)

    # Insulation laid between the joists.
    for wave_x in range(left[0] + 40, right[0] - 60, 26):
        points = [
            (wave_x + math.sin(step / 10) * 6, ceiling_y - 4 - step)
            for step in range(0, 26, 4)
        ]
        line(draw, points, fill=RULE, width=1)

    # The run carried over the joists on saddles, then dropping through.
    run_y = ceiling_y - 60
    route = [(330, run_y), (700, run_y), (700, run_y - 90), (1120, run_y - 90), (1120, run_y + 150)]
    line(draw, route, fill=BRASS, width=4)
    for node in route[1:-1]:
        dot(draw, node, 8)
    for sx in (430, 560, 860, 990):
        line(draw, [(sx, run_y + 4), (sx, ceiling_y - 4)], fill=INK_SOFT, width=1)
        line(draw, [(sx - 12, run_y + 4), (sx + 12, run_y + 4)], fill=INK_SOFT, width=1)

    # Fitting hanging below the ceiling on the drop.
    ring(draw, (1120, run_y + 176), 22)
    line(draw, [(1098, run_y + 176), (1142, run_y + 176)], fill=INK, width=2)

    # Access hatch.
    rect(draw, (420, ceiling_y, 560, ceiling_y + 34), width=3, fill=PAPER)
    dashed(draw, (420, ceiling_y + 34), (420, ceiling_y + 120))
    dashed(draw, (560, ceiling_y + 34), (560, ceiling_y + 120))

    leader(draw, (700, run_y - 90), (700, 300), run=120)
    leader(draw, (490, ceiling_y + 34), (300, ceiling_y + 150), run=110, flip=True)

    dimension(draw, left[0], right[0], ceiling_y + 200)
    vdimension(draw, apex[1], ceiling_y, left[0] - 80)
    title_block(draw, width, height)
    save(image, width, height, path)


def site_plan_plate(path, width=1600, height=1000):
    """Site plan: dwelling, workshop and the underground run between them."""
    image, draw = plate(width, height)
    grid(draw, width, height, step=25)
    border(draw, width, height)

    # Boundary.
    bx0, by0, bx1, by1 = 200, 155, 1400, 840
    rect(draw, (bx0, by0, bx1, by1), outline=INK_SOFT, width=2)
    for x in range(bx0, bx1, 46):
        line(draw, [(x, by1), (x + 16, by1 + 14)], fill=RULE, width=1)

    # Dwelling, with its internal room lines so it is not a blank box.
    dx0, dy0, dx1, dy1 = 300, 260, 820, 700
    rect(draw, (dx0, dy0, dx1, dy1), fill=PAPER_DEEP)
    rect(draw, (dx0, dy0, dx1, dy1), width=3)
    line(draw, [(dx0 + 210, dy0), (dx0 + 210, dy1)], fill=INK_SOFT, width=1)
    line(draw, [(dx0 + 210, dy0 + 190), (dx1, dy0 + 190)], fill=INK_SOFT, width=1)
    line(draw, [(dx0, dy0 + 300), (dx0 + 210, dy0 + 300)], fill=INK_SOFT, width=1)
    # Roof ridge, dashed, as a site plan shows it.
    dashed(draw, (dx0 + 260, dy0), (dx0 + 260, dy1))

    # Workshop.
    wx0, wy0, wx1, wy1 = 1020, 460, 1300, 700
    rect(draw, (wx0, wy0, wx1, wy1), fill=PAPER_DEEP)
    rect(draw, (wx0, wy0, wx1, wy1), width=3)
    for bay in range(1, 3):
        line(draw, [(wx0 + bay * 93, wy0), (wx0 + bay * 93, wy1)], fill=RULE, width=1)
    # Roller door on the near face.
    rect(draw, (wx0 + 40, wy1 - 8, wx1 - 40, wy1 + 8), width=2, fill=PAPER)

    # Meter position on the dwelling.
    rect(draw, (dx1, dy0 + 120, dx1 + 60, dy0 + 190), width=2, fill=PAPER)

    # Driveway, hatched, giving the empty half of the sheet a surface.
    hatch(draw, (860, 700, 1400, 800), spacing=26)
    line(draw, [(860, 700), (1400, 700)], fill=RULE, width=1)
    line(draw, [(860, 800), (1400, 800)], fill=RULE, width=1)

    # Underground run, drawn dashed because it is buried, with a trench width.
    route = [(dx1 + 60, dy0 + 155), (940, dy0 + 155), (940, 560), (wx0, 560)]
    for start, end in zip(route, route[1:]):
        dashed(draw, start, end, fill=BRASS, width=3, dash=20, gap=12)
    for node in route:
        dot(draw, node, 8)
    # Trench edges either side of the buried run.
    dashed(draw, (930, dy0 + 165), (930, 570), fill=RULE)
    dashed(draw, (950, dy0 + 165), (950, 570), fill=RULE)

    # Draw pit at the change of direction.
    rect(draw, (912, 532, 968, 588), width=2, fill=PAPER)

    # Existing pole and overhead span to the boundary, shown as found.
    ring(draw, (1360, 250), 14, outline=INK, width=2)
    dashed(draw, (1360, 250), (dx1 + 30, dy0 + 60), fill=INK_SOFT)

    # North point: a site plan is meaningless without one.
    nx, ny = 260, 890
    line(draw, [(nx, ny + 34), (nx, ny - 34)], width=2)
    line(draw, [(nx - 14, ny - 6), (nx, ny - 34), (nx + 14, ny - 6)], width=2)
    ring(draw, (nx, ny), 34, outline=RULE, width=1, fill=None)

    leader(draw, (940, 560), (700, 880), run=120, flip=True)
    leader(draw, (wx0 + 140, wy0), (wx0 + 140, 340), run=110)

    dim_chain(draw, [dx0, dx1, wx0, wx1], by1 + 60)
    vdimension(draw, dy0, dy1, dx0 - 60)
    title_block(draw, width, height)
    save(image, width, height, path)


# --------------------------------------------------------------------------
# Square plates, 1100x1100.
# --------------------------------------------------------------------------


def detail_plate(path, width=1100, height=1100):
    """Square close detail: a terminal block with conductor terminations."""
    image, draw = plate(width, height)
    grid(draw, width, height, step=50)
    border(draw, width, height, inset=50)

    bx0, by0, bx1, by1 = 150, 330, 950, 620
    rect(draw, (bx0, by0, bx1, by1), fill=PAPER_DEEP)
    rect(draw, (bx0, by0, bx1, by1), width=3)
    # Mounting rail behind the block.
    rect(draw, (bx0 - 40, by1 + 10, bx1 + 40, by1 + 42), width=2, fill=PAPER)
    hatch(draw, (bx0 - 40, by1 + 10, bx1 + 40, by1 + 42), spacing=14)

    # Nine terminals with screw heads.
    for index in range(9):
        x = bx0 + 30 + index * 84
        rect(draw, (x, by0 + 30, x + 58, by1 - 30), width=2, fill=PAPER)
        cx, cy = x + 29, by0 + 78
        ring(draw, (cx, cy), 17, outline=INK, width=2, fill=PAPER_DEEP)
        line(draw, [(cx - 11, cy), (cx + 11, cy)], fill=INK, width=2)

        # Conductor entering from below, alternating brass and ink so the plate
        # distinguishes live runs from the earth bar.
        conductor = BRASS if index % 3 != 2 else INK_SOFT
        tail = by1 + 130 + (index % 3) * 52
        line(draw, [(cx, by1 - 30), (cx, tail)], fill=conductor, width=3)
        dot(draw, (cx, tail), 7, fill=conductor)
        # Sleeve, drawn where the conductor passes the gland plate.
        rect(draw, (cx - 12, by1 + 60, cx + 12, by1 + 92), width=1, fill=PAPER)

    # Gland plate the tails pass through.
    line(draw, [(bx0 - 40, by1 + 76), (bx1 + 40, by1 + 76)], fill=INK_SOFT, width=1)

    # Feed entering the block from the left.
    line(draw, [(80, by0 - 150), (80, (by0 + by1) // 2), (bx0, (by0 + by1) // 2)], fill=BRASS, width=4)
    dot(draw, (80, by0 - 150), 9)

    leader(draw, (bx0 + 59, by0 + 78), (bx0 + 59, 190), run=110)
    leader(draw, (bx0 + 450, by1 + 76), (bx1 - 40, by1 + 250), run=100)

    dim_chain(draw, [bx0, bx0 + 84, bx0 + 168, bx0 + 252], by0 - 60)
    dimension(draw, bx0, bx1, by1 + 330)
    save(image, width, height, path)


def cable_schedule_plate(path, width=1100, height=1100):
    """Square plate: a cable schedule as a ruled, unlettered table."""
    image, draw = plate(width, height)
    grid(draw, width, height, step=50)
    border(draw, width, height, inset=50)

    tx0, ty0, tx1, ty1 = 130, 200, 970, 870
    rect(draw, (tx0, ty0, tx1, ty1), fill=PAPER_DEEP)
    rect(draw, (tx0, ty0, tx1, ty1), width=3)

    columns = [tx0, tx0 + 130, tx0 + 420, tx0 + 630, tx1]
    header_y = ty0 + 74
    line(draw, [(tx0, header_y), (tx1, header_y)], width=2)
    for cx in columns[1:-1]:
        line(draw, [(cx, ty0), (cx, ty1)], fill=INK_SOFT, width=1)
    for index, (start, end) in enumerate(zip(columns, columns[1:])):
        label_rule(draw, start + 22, ty0 + 44, min(end - start - 44, 120), fill=INK)

    rows = 9
    row_height = (ty1 - header_y) / rows
    for row in range(rows):
        y = header_y + row_height * (row + 0.5)
        if row:
            line(
                draw,
                [(tx0, header_y + row_height * row), (tx1, header_y + row_height * row)],
                fill=RULE,
                width=1,
            )
        # Reference column: short rule.
        label_rule(draw, columns[0] + 30, y, 68)
        # Description: a long rule, varied so the table has texture.
        label_rule(draw, columns[1] + 32, y, 200 + (row % 3) * 26)
        # Size: medium rule.
        label_rule(draw, columns[2] + 30, y, 128)
        # Status: a dot and a short rule.
        dot(draw, (columns[3] + 46, y), 7, fill=BRASS if row % 2 == 0 else INK_SOFT)
        label_rule(draw, columns[3] + 76, y, 82)

    # Revision triangle, the convention for an amended row.
    rev_y = header_y + row_height * 3.5
    line(
        draw,
        [(tx0 - 44, rev_y + 14), (tx0 - 20, rev_y - 16), (tx0 + 4, rev_y + 14), (tx0 - 44, rev_y + 14)],
        fill=BRASS,
        width=2,
    )

    dimension(draw, tx0, tx1, ty1 + 60)
    save(image, width, height, path)


def board_detail_plate(path, width=1100, height=1100):
    """Square close detail of a board interior: rail, ways, bars and tails.

    Drawn dense on purpose. The earlier version of this plate placed a small
    enclosure in the middle of an otherwise empty sheet, which cropped to a blank
    rectangle at the sizes the record layout actually uses it at.
    """
    image, draw = plate(width, height)
    grid(draw, width, height, step=50)
    border(draw, width, height, inset=50)

    ex0, ey0, ex1, ey1 = 110, 130, 990, 900

    # Enclosure, cut, with the wall behind it hatched.
    hatch(draw, (ex0 - 46, ey0, ex0 - 10, ey1), spacing=14)
    line(draw, [(ex0 - 46, ey0), (ex0 - 46, ey1)], fill=INK_SOFT, width=1)
    rect(draw, (ex0, ey0, ex1, ey1), fill=PAPER_DEEP)
    rect(draw, (ex0, ey0, ex1, ey1), width=4)
    rect(draw, (ex0 + 22, ey0 + 22, ex1 - 22, ey1 - 22), outline=INK_SOFT, width=1)

    # Incoming tails entering the top of the enclosure.
    for index, tx in enumerate((ex0 + 150, ex0 + 210, ex0 + 270)):
        colour = BRASS if index == 0 else INK_SOFT
        line(draw, [(tx, ey0 - 90), (tx, ey0 + 96)], fill=colour, width=4)
        rect(draw, (tx - 16, ey0 - 14, tx + 16, ey0 + 26), width=1, fill=PAPER)

    # Main switch, top left, weightier than the ways.
    rect(draw, (ex0 + 108, ey0 + 96, ex0 + 312, ey0 + 236), width=3, fill=PAPER)
    for index in range(3):
        sx = ex0 + 136 + index * 60
        rect(draw, (sx, ey0 + 122, sx + 34, ey0 + 210), width=2, fill=PAPER_DEEP)
        line(draw, [(sx + 8, ey0 + 150), (sx + 26, ey0 + 150)], fill=INK, width=2)

    # Busbar comb feeding the ways.
    comb_y = ey0 + 240
    line(draw, [(ex0 + 108, comb_y), (ex1 - 190, comb_y)], fill=BRASS, width=6)
    line(draw, [(ex0 + 222, ey0 + 206), (ex0 + 222, comb_y)], fill=BRASS, width=5)

    # Two DIN rails of ways, filling the body of the enclosure.
    way_height = 108
    for row, ry in enumerate((comb_y + 34, comb_y + 230)):
        # The rail itself, cut.
        rect(draw, (ex0 + 96, ry + way_height, ex1 - 184, ry + way_height + 22), width=1, fill=PAPER)
        hatch(draw, (ex0 + 96, ry + way_height, ex1 - 184, ry + way_height + 22), spacing=11)
        for index in range(10):
            x = ex0 + 108 + index * 66
            rect(draw, (x, ry, x + 48, ry + way_height), width=2, fill=PAPER)
            up = (index + row) % 3 != 0
            ty = ry + (20 if up else 62)
            rect(draw, (x + 14, ty, x + 34, ty + 26), width=2, fill=INK if up else PAPER)
            # Way number field and the comb tooth feeding it.
            label_rule(draw, x + 6, ry - 14, 36, fill=RULE)
            line(draw, [(x + 24, ry - 42 if row else comb_y), (x + 24, ry)], fill=BRASS, width=2)
        if row == 1:
            # The second rail is fed by a dropper off the comb, not by the comb.
            line(draw, [(ex0 + 108, ry - 42), (ex1 - 190, ry - 42)], fill=BRASS, width=5)
            line(draw, [(ex0 + 132, comb_y), (ex0 + 132, ry - 42)], fill=BRASS, width=4)

    # Neutral bar and earth bar at the foot, each with its terminations.
    for bar_index, bar_y in enumerate((ey1 - 158, ey1 - 86)):
        rect(draw, (ex0 + 96, bar_y, ex1 - 184, bar_y + 34), width=2, fill=PAPER)
        for index in range(13):
            sx = ex0 + 122 + index * 48
            ring(draw, (sx, bar_y + 17), 9, outline=INK_SOFT, width=1, fill=PAPER_DEEP)
            line(
                draw,
                [(sx, bar_y - (22 if bar_index else 0)), (sx, bar_y + 8)],
                fill=INK_SOFT if bar_index else BRASS,
                width=1,
            )

    # Circuit-label card inside the door, ruled and unlettered.
    rect(draw, (ex1 - 96, ey0 + 60, ex1 - 42, ey1 - 200), outline=INK_SOFT, width=1, fill=PAPER)
    for y in range(int(ey0) + 84, int(ey1) - 220, 30):
        label_rule(draw, ex1 - 88, y, 38, fill=RULE)

    # Leaders stay inside the sheet: there is no margin beside a full-bleed
    # enclosure, so they point into the clear area above the busbar.
    leader(draw, (ex0 + 400, comb_y), (ex0 + 452, ey0 + 108), run=170)
    leader(draw, (ex0 + 598, comb_y + 34), (ex0 + 512, ey0 + 168), run=110)

    dim_chain(draw, [ex0, ex0 + 293, ex0 + 586, ex1], ey1 + 60)
    vdimension(draw, ey0, ey1, ex1 + 50)
    save(image, width, height, path)


if __name__ == "__main__":
    root = sys.argv[1]
    switchboard_plate(f"{root}/plates/switchboard.png")
    circuit_plan_plate(f"{root}/plates/circuit-plan.png")
    facade_plate(f"{root}/plates/facade.png")
    wall_section_plate(f"{root}/plates/wall-section.png")
    schematic_plate(f"{root}/plates/schematic.png")
    roof_space_plate(f"{root}/plates/roof-space.png")
    site_plan_plate(f"{root}/plates/site-plan.png")
    detail_plate(f"{root}/plates/junction-detail.png")
    cable_schedule_plate(f"{root}/plates/cable-schedule.png")
    board_detail_plate(f"{root}/plates/board-detail.png")
