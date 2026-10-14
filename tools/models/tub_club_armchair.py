"""
Tub club armchair, built procedurally in Blender.

Run (no UI needed):
    blender -b --factory-startup --python tools/models/tub_club_armchair.py -- <output_dir>

Writes to <output_dir>: model.glb, model.usdz, thumbnail.jpg; and to <output_dir>/_build/
the generated textures and preview renders (git-ignored). Model rules (CLAUDE.md 4.5):
meters, real size, Y-up in the exported files, origin at the bottom center, PBR materials,
<= 5 MB.

Blender is Z-up; the glTF exporter converts to Y-up. The chair's front faces Blender -Y,
which becomes glTF +Z (the app turns +Z toward the camera when placing).

Shape reference: product photo of a cognac microsuede tub chair. A round back flowing into
thick rolled arms that run straight to the front and end in flat padded panels with a welt;
a tall tight seat whose front panel is flush with the arm fronts; a bowl-shaped body that
tapers toward the bottom; four splayed, tapered oak legs.
"""

import math
import os
import sys

import bmesh
import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import modelkit as mk  # noqa: E402

# --- Real dimensions (meters) -------------------------------------------------------------
WIDTH = 0.76
DEPTH = 0.74
HEIGHT = 0.78
SEAT_HEIGHT = 0.45

BODY_BOTTOM = 0.21  # underside of the upholstered body (top of the legs)

# Shell (back + arms) seen from above: straight arms along the sides, joined by a rounded
# back (a superellipse half-arc).
BACK_EXP = 2.4  # > 2 = squarer than a circle
BACK_DEPTH_RATIO = 0.74  # depth of the back arc relative to the half width
SHELL_THICKNESS = 0.14  # rolled arms are thick
ARM_FRONT_TOP = 0.62
BOWL_TAPER = 0.045  # the body is this much narrower at the bottom (each side)
RING_SIZE = 10  # vertices in the shell's cross-section
SEAM_INDEX = 6  # cross-section vertex on the inner seam (see build_shell)
SEAM_CREASE = 0.6  # subdivision crease along the seams that carry a welt
WELT_RADIUS = 0.0035  # piping cord along the seams


class Params:
    """Raw construction sizes. Subdivision smoothing shrinks the outer surfaces, so these are
    corrected after measuring until the finished chair matches WIDTH x DEPTH x HEIGHT."""

    shell_a = WIDTH / 2  # outer half width
    back_y = DEPTH / 2  # outermost point of the back (+Y)
    front_y = -DEPTH / 2  # arm front panels (-Y)
    back_top = HEIGHT  # top of the backrest
    seat_top = SEAT_HEIGHT  # top of the seat


P = Params()

FABRIC_TILE_M = 0.30  # large tile: brushed nap marks must not visibly repeat
# Average fabric color (sRGB), from the product photo: lit arm tops ~(190,105,62), shaded
# sides ~(140,72,42), under bright shop light. A cognac microsuede; the texture averages to
# exactly this.
FABRIC_COLOR = (142 / 255, 74 / 255, 41 / 255)
WOOD_TILE_M = 0.10
WOOD_COLOR = (150 / 255, 106 / 255, 68 / 255)  # medium oak, satin finish


# --- Textures -----------------------------------------------------------------------------


def suede_images(directory, size=2048, seed=11):
    """Microsuede (tileable): no weave, a fine directional pile brushed into soft marks.

    - flow: a smooth field giving the pile direction at each point;
    - nap marks: noise smeared along the flow (~2 cm strokes), the light/dark "writing"
      brushed suede shows; stronger in some patches than others;
    - patches: soft uneven light/dark areas at several scales, the main visible character;
    - dye: fine uneven coloring;
    - fibers: very fine, faint short streaks along the same flow (strong ones read as fur);
    Darker pile is also more saturated (deeper red-brown), like real suede.

    Pixel parameters were tuned at 1024 px and scale with `size`, so the look stays the same
    in centimeters at any resolution (box-blur passes scale with the square)."""
    rng = np.random.default_rng(seed)
    k = size / 1024
    flow = np.pi * mk.tileable_noise(rng, size, [(1, 1.0), (2, 0.5)])
    patches = mk.tileable_noise(rng, size, [(2, 1.0), (4, 0.6), (8, 0.3)])
    nap = mk.normalize(mk.streaks(mk.blur_wrap(rng.normal(0, 1, (size, size)).astype(np.float32), round(12 * k * k)),
                                  flow, round(48 * k)))
    fibers = mk.normalize(mk.streaks(rng.normal(0, 1, (size, size)).astype(np.float32), flow, round(2 * k)))

    dye = mk.normalize(mk.blur_wrap(rng.normal(0, 1, (size, size)).astype(np.float32), round(5 * k * k)))
    # Directional marks stay faint: stronger ones form graphic swirls, not suede.
    pile = 0.012 * nap * (0.5 + 0.5 * patches) + 0.035 * patches + 0.01 * dye + 0.012 * fibers
    shade = 1.0 + pile
    color = np.array(FABRIC_COLOR, dtype=np.float32) * np.stack([shade, shade ** 1.15, shade ** 1.3], axis=2)
    color = mk.match_mean(color, FABRIC_COLOR, "fabric")

    color_img = mk.save_image("suede_color", color, os.path.join(directory, "suede_color.jpg"), "JPEG", "sRGB")
    # JPEG maps: noise compresses badly as PNG and the fine detail hides JPEG artifacts.
    normal_img = mk.save_image("suede_normal", mk.normal_from_height(0.7 * fibers + 0.3 * nap, 0.05 * k),
                               os.path.join(directory, "suede_normal.jpg"), "JPEG", "Non-Color")
    return color_img, normal_img


def wood_images(directory, width=256, height=1024, seed=5):
    """Oak grain running along v (the leg's length), tileable."""
    rng = np.random.default_rng(seed)
    v, u = np.mgrid[0:height, 0:width].astype(np.float32)
    u, v = u / width, v / height
    # Grain lines: stripes across u, wavering along v.
    warp = sum(a * np.sin(2 * np.pi * (k * v) + rng.uniform(0, 2 * np.pi))
               for k, a in ((1, 0.06), (3, 0.025), (7, 0.01)))
    rings = np.sin(2 * np.pi * (14 * (u + warp))) * 0.5 + 0.5
    rings = rings ** 3  # thin dark latewood lines on lighter earlywood
    pores = rng.normal(0, 1, (height, width)).astype(np.float32)
    pores = (pores + np.roll(pores, 1, 0) + np.roll(pores, 2, 0) + np.roll(pores, 3, 0)) / 4  # streaks along v
    tone = 1.0 - 0.22 * rings + 0.05 * pores
    color = np.array(WOOD_COLOR, dtype=np.float32) * tone[..., None]
    color = mk.match_mean(color, WOOD_COLOR, "wood")

    color_img = mk.save_image("oak_color", color, os.path.join(directory, "oak_color.jpg"), "JPEG", "sRGB")
    normal_img = mk.save_image("oak_normal", mk.normal_from_height(-rings * 0.3 + pores * 0.1, 0.8),
                               os.path.join(directory, "oak_normal.jpg"), "JPEG", "Non-Color")
    return color_img, normal_img


# --- Materials ----------------------------------------------------------------------------


def suede_material(color_img, normal_img):
    mat, bsdf = mk.textured_material("Microsuede", color_img, normal_img, normal_strength=0.35, roughness=0.85)
    # Brushed-nap highlight at grazing angles (exported as KHR_materials_sheen).
    mk.sheen(bsdf, weight=0.3, tint=(0.95, 0.62, 0.42), roughness=0.45)
    return mat


def oak_material(color_img, normal_img):
    mat, bsdf = mk.textured_material("Oak", color_img, normal_img, normal_strength=0.4, roughness=0.55)
    # Satin lacquer over the grain (exported as KHR_materials_clearcoat).
    mk.clearcoat(bsdf, weight=0.6, roughness=0.25)
    return mat


# --- Parts --------------------------------------------------------------------------------


def outline():
    """Outer contour of the shell at the top, from the right arm front, around the back, to
    the left arm front, as (x, y, inset_fn) where inset_fn(d) gives the point d inside it."""
    a = P.shell_a
    b = BACK_DEPTH_RATIO * a
    y_c = P.back_y - b  # where the straight arms meet the back arc
    points = []

    def arm(sign, y):
        return lambda d: (sign * (a - d), y)

    def arc(phi):
        def inset(d):
            x, y = mk.superellipse(phi, a - d, b - d, BACK_EXP)
            return x, y_c + y
        return inset

    # Right arm: front panel, a support loop just behind it, then evenly to the back arc.
    arm_ys = [P.front_y, P.front_y + 0.012, P.front_y + 0.045]
    n_arm = 16  # dense enough to carry the seam puckers (see add_detail)
    arm_ys += [P.front_y + 0.045 + (y_c - P.front_y - 0.045) * i / n_arm for i in range(1, n_arm)]
    points += [arm(1, y) for y in arm_ys]
    n_arc = 72
    points += [arc(math.pi * i / n_arc) for i in range(n_arc + 1)]
    points += [arm(-1, y) for y in reversed(arm_ys)]
    return points


def shell_top(t):
    """Rim height: rises gently along the arms, then up the rounded back.
    t is 0 at the arm fronts and 1 at the back center (by length along the contour)."""
    k = min(max(t, 0.0) / 0.9, 1.0)
    return ARM_FRONT_TOP + (P.back_top - ARM_FRONT_TOP) * math.sin(k * math.pi / 2) ** 3.5


def build_shell(fabric):
    """Back + arms as one tube swept along the outline; subdivision rounds it into a rolled
    profile. The arm ends are capped with slightly padded flat panels."""
    T = SHELL_THICKNESS
    contour = outline()
    centers = [c(0.0) for c in contour]
    lengths = np.concatenate([[0], np.cumsum([math.dist(p, q) for p, q in zip(centers, centers[1:])])])
    half = lengths[-1] / 2

    verts, faces = [], []
    for inset_at, s in zip(contour, lengths):
        t = 1 - abs(s - half) / half
        top = shell_top(t)
        h = top - BODY_BOTTOM
        profile = [
            (BOWL_TAPER, BODY_BOTTOM + 0.02),  # outer bottom (the bowl tapers in)
            (0.012, BODY_BOTTOM + 0.45 * h),  # outer side
            (0.0, top - 0.07),  # outer side, top of the swell
            (0.02, top - 0.02),  # rolled top
            (T * 0.45, top),
            (T - 0.03, top - 0.015),
            (T, top - 0.055),  # SEAM_INDEX: inner panel meets the rolled top
            (T + 0.004, BODY_BOTTOM + 0.5 * h),  # inner face
            (T, BODY_BOTTOM),  # inner bottom
            ((T + BOWL_TAPER) / 2, BODY_BOTTOM - 0.002),  # underside: rounds the bottom corners
        ]
        for d, z in profile:
            x, y = inset_at(d)
            verts.append((x, y, z))

    ring = RING_SIZE
    rings = len(contour)
    for i in range(rings - 1):
        a, b = ring * i, ring * (i + 1)
        for k in range(ring):
            k2 = (k + 1) % ring
            faces.append((a + k, b + k, b + k2, a + k2))

    # Arm front panels: an inset ring pushed slightly forward (padding), then a center face.
    for first, outward in ((0, -1.0), (rings - 1, -1.0)):
        base = first * ring
        pts = np.array(verts[base:base + ring])
        c = pts.mean(axis=0)
        start = len(verts)
        for p in pts:
            q = c + (p - c) * 0.72
            q[1] += outward * 0.006
            verts.append(tuple(q))
        inner = list(range(start, start + ring))
        outer = list(range(base, base + ring))
        for k in range(ring):
            k2 = (k + 1) % ring
            quad = (outer[k], outer[k2], inner[k2], inner[k])
            faces.append(quad if first == 0 else quad[::-1])
        faces.append(tuple(inner) if first == 0 else tuple(reversed(inner)))

    obj = mk.mesh_object("Shell", verts, faces, fabric)
    mesh = obj.data
    mesh.update()
    # Make all normals point outward (the caps' winding depends on the profile direction).
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    mk.box_uvs(obj, FABRIC_TILE_M)
    front_rings = set(range(0, ring)) | set(range((rings - 1) * ring, rings * ring))
    shell_verts = rings * ring
    mk.crease_edges(obj, lambda a, b: a in front_rings and b in front_rings, SEAM_CREASE)
    mk.crease_edges(obj, lambda a, b: a < shell_verts and b < shell_verts
                    and a % ring == SEAM_INDEX and b % ring == SEAM_INDEX, SEAM_CREASE)
    mk.add_subsurf(obj, 2)

    # Welt guides (cage points; the welts snap them onto the smoothed surface).
    seams = {
        "WeltTop": ([verts[i * ring + SEAM_INDEX] for i in range(rings)], False),
        "WeltArmR": (verts[:ring], True),
        "WeltArmL": (verts[(rings - 1) * ring:rings * ring], True),
    }
    return obj, seams


def build_seat(fabric):
    """Tight seat: a tall box with a flat front panel flush with the arm fronts; its sides
    and back tuck into the shell."""
    a = P.shell_a
    b = BACK_DEPTH_RATIO * a
    y_c = P.back_y - b
    inner_back = y_c + (b - SHELL_THICKNESS)
    seat = mk.pillow(
        "Seat",
        x_half=a - SHELL_THICKNESS + 0.025,
        y_range=(P.front_y + 0.006, inner_back + 0.01),
        z_range=(BODY_BOTTOM - 0.002, P.seat_top),
        material=fabric,
        exp_h=5.0,
        exp_v=7.0,
        tile=FABRIC_TILE_M,
        crown=0.04,
        cuts=18,
    )
    # Welt along the front top edge; its ends run into the arms. Guide points sit just off
    # the edge so they snap onto its crest.
    x_end = a - SHELL_THICKNESS + 0.02
    guide = [(x, P.front_y - 0.01, P.seat_top + 0.01) for x in np.linspace(-x_end, x_end, 40)]
    return seat, guide


def build_bottom(fabric):
    """Underside panel: closes the bowl between the shell and the seat."""
    a = P.shell_a
    return mk.pillow(
        "Bottom",
        x_half=a - BOWL_TAPER - 0.02,
        y_range=(P.front_y + 0.02, P.back_y - BOWL_TAPER - 0.03),
        z_range=(BODY_BOTTOM - 0.004, BODY_BOTTOM + 0.05),
        material=fabric,
        exp_h=3.0,
        exp_v=6.0,
        tile=FABRIC_TILE_M,
    )


def tapered_leg(name, top, foot, r_top, r_foot, material, sides=24):
    """Round leg tapering toward the foot; the foot is cut level so it stands flat."""
    top, foot = np.array(top, dtype=float), np.array(foot, dtype=float)
    axis = (foot - top) / np.linalg.norm(foot - top)
    side = np.cross(axis, [0.0, 0.0, 1.0])
    side /= np.linalg.norm(side)
    up = np.cross(side, axis)
    circumference = 2 * math.pi * r_top

    stations = [0.0, 0.5, 1.0]  # along the leg; the middle loop keeps the taper straight
    verts = []
    for s in stations:
        center = top + (foot - top) * s
        r = r_top + (r_foot - r_top) * s
        for i in range(sides):
            ang = 2 * math.pi * i / sides
            p = center + r * (math.cos(ang) * side + math.sin(ang) * up)
            if s == 1.0:
                p = p - axis * ((p[2] - foot[2]) / axis[2])  # level foot
            verts.append(tuple(p))
    faces = []
    row = sides
    for j in range(len(stations) - 1):
        for i in range(sides):
            i2 = (i + 1) % sides
            a, a2, b, b2 = j * row + i, j * row + i2, (j + 1) * row + i, (j + 1) * row + i2
            faces.append((a, a2, b2, b))
    top_cap = tuple(range(sides - 1, -1, -1))
    foot_cap = tuple((len(stations) - 1) * row + i for i in range(sides))
    faces += [top_cap, foot_cap]

    obj = mk.mesh_object(name, verts, faces, material)
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    # Caps flat, sides smooth, with a sharp edge between them.
    sharp = mesh.attributes.get("sharp_edge") or mesh.attributes.new("sharp_edge", "BOOLEAN", "EDGE")
    for poly in mesh.polygons:
        poly.use_smooth = poly.loop_total == 4
    for e in mesh.edges:
        faces_of = [p for p in mesh.polygons if e.key in p.edge_keys]
        if any(p.loop_total != 4 for p in faces_of):
            sharp.data[e.index].value = True

    # Cylindrical UVs around the leg, grain along its length.
    layer = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        loop_uvs = []
        for li in poly.loop_indices:
            co = np.array(mesh.vertices[mesh.loops[li].vertex_index].co)
            rel = co - top
            s = float(np.dot(rel, axis))
            ang = math.atan2(float(np.dot(rel, up)), float(np.dot(rel, side))) % (2 * math.pi)
            loop_uvs.append([ang / (2 * math.pi) * circumference / WOOD_TILE_M * 4, s / WOOD_TILE_M])
        us = [uv[0] for uv in loop_uvs]
        if max(us) - min(us) > circumference / WOOD_TILE_M * 2:  # face straddles the seam
            for uv in loop_uvs:
                if uv[0] < circumference / WOOD_TILE_M * 2:
                    uv[0] += circumference / WOOD_TILE_M * 4
        for li, uv in zip(poly.loop_indices, loop_uvs):
            layer.data[li].uv = uv
    return obj


def build_legs(oak):
    legs = []
    # (top x, top y), (foot x, foot y): splayed outward, the front pair also forward and the
    # back pair backward.
    front_top, front_foot = (0.25, P.front_y + 0.13), (0.30, P.front_y + 0.07)
    back_top, back_foot = (0.23, 0.12), (0.28, 0.20)
    for i, ((tx, ty), (fx, fy)) in enumerate([(front_top, front_foot), (back_top, back_foot)]):
        for sx in (1, -1):
            legs.append(tapered_leg(f"Leg{i}{'R' if sx > 0 else 'L'}", (sx * tx, ty, BODY_BOTTOM + 0.03),
                                    (sx * fx, fy, 0.0), 0.021, 0.012, oak))
    return legs


# --- Surface detail -----------------------------------------------------------------------


def seat_sag(mesh, depth=0.015):
    """Soft dip in the seat top where people sit (centered a little behind the middle)."""
    a = P.shell_a
    b = BACK_DEPTH_RATIO * a
    inner_back = P.back_y - b + (b - SHELL_THICKNESS)
    x_half = a - SHELL_THICKNESS
    y_mid = (P.front_y + inner_back) / 2 + 0.03
    y_half = (inner_back - P.front_y) / 2
    co, nor = mk.vertex_arrays(mesh)
    on_top = (nor[:, 2] > 0.6) & (np.abs(co[:, 2] - P.seat_top) < 0.03)
    u = co[:, 0] / (0.85 * x_half)
    v = (co[:, 1] - y_mid) / (0.85 * y_half)
    bump = np.clip(1 - u * u - v * v, 0, None) ** 2
    co[:, 2] -= depth * bump * on_top
    mesh.vertices.foreach_set("co", co.ravel())
    mesh.update()


def add_detail(fabric):
    """Bakes the smoothed upholstery into one mesh and adds what subdivision can't: seat sag
    and stitching puckers along the welted seams (no overall unevenness: the reference chair
    is upholstered tight, and wave-based lumps read as corrugation). Then joins the welts,
    so the result is one upholstery mesh ready for the AO bake."""
    parts = [o for o in bpy.context.scene.objects if o.type == "MESH" and fabric.name in o.data.materials]
    welts = [o for o in parts if o.name.startswith("Welt")]
    body = mk.join_applied([o for o in parts if o not in welts], "Body")
    seat_sag(body.data)
    mk.seam_puckers(body.data, welts, seed=4)
    upholstery = mk.join_applied([body] + welts, "Upholstery")
    mk.remove_hidden_faces(upholstery)
    return upholstery


# --- Build --------------------------------------------------------------------------------


def main():
    directory = mk.out_dir()
    build_dir = os.path.join(directory, "_build")
    os.makedirs(build_dir, exist_ok=True)
    mk.reset_scene()
    suede = suede_material(*suede_images(build_dir))
    oak = oak_material(*wood_images(build_dir))

    # Build, measure, correct: smoothing shrinks the shell, so iterate until the real size
    # matches the catalog dimensions (AR shows it 1:1).
    for attempt in range(8):
        mk.clear_objects()
        shell, seams = build_shell(suede)
        seat, seat_guide = build_seat(suede)
        build_bottom(suede)
        build_legs(oak)
        for name, (points, closed) in seams.items():
            mk.welt(name, points, shell, WELT_RADIUS, suede, FABRIC_TILE_M, closed)
        mk.welt("WeltSeat", seat_guide, seat, WELT_RADIUS, suede, FABRIC_TILE_M)
        mins, maxs, tris = mk.evaluated_bounds()
        _, seat_max, _ = mk.evaluated_bounds([seat])
        errors = {
            "width": WIDTH / 2 - maxs[0],
            "back": DEPTH / 2 - maxs[1],
            "front": -DEPTH / 2 - mins[1],
            "height": HEIGHT - maxs[2],
            "seat": SEAT_HEIGHT - seat_max[2],
        }
        print(f"REPORT attempt {attempt}: " + ", ".join(f"{k}={v * 1000:+.1f}mm" for k, v in errors.items()))
        if all(abs(e) <= mk.SIZE_TOLERANCE_M for e in errors.values()):
            break
        P.shell_a += errors["width"]
        P.back_y += errors["back"]
        P.front_y += errors["front"]
        P.back_top += errors["height"]
        P.seat_top += errors["seat"]

    mk.check_and_report(mins, maxs, tris, seat_max[2])

    upholstery = add_detail(suede)
    mk.bake_ao(upholstery, os.path.join(build_dir, "upholstery_ao.jpg"))
    mk.export(directory)
    mk.render_previews(directory, build_dir, distance=2.4, target_z=0.38)
    print("REPORT done")


main()
