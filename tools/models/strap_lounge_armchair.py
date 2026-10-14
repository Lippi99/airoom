"""
Strap lounge armchair, built procedurally in Blender.

Run (no UI needed):
    blender -b --factory-startup --python tools/models/strap_lounge_armchair.py -- <output_dir>

Writes to <output_dir>: model.glb, model.usdz, thumbnail.jpg; and to <output_dir>/_build/
the generated textures and preview renders (git-ignored). Model rules (CLAUDE.md 4.5):
meters, real size, Y-up in the exported files, origin at the bottom center, PBR materials,
2K textures, <= 5 MB uncompressed.

Blender is Z-up; the glTF exporter converts to Y-up. The chair's front faces Blender -Y,
which becomes glTF +Z (the app turns +Z toward the camera when placing).

Shape reference: product photo of a solid-wood lounge chair. Honey-toned hardwood frame
with splayed rectangular legs, flat armrest boards, side and apron rails; vertical beige
webbing straps looped over a rail under each armrest and on the reclined back; a linen box
seat cushion piped on its top and bottom edges and a plump piped linen back cushion.
"""

import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import modelkit as mk  # noqa: E402

# --- Real dimensions (meters) -------------------------------------------------------------
WIDTH = 0.72
DEPTH = 0.78
HEIGHT = 0.80  # top of the back cushion
SEAT_HEIGHT = 0.45  # top of the seat cushion

# Side frames (one per side, centered on X_SIDE).
ARM_W, ARM_T = 0.065, 0.03  # armrest board: width (X) and thickness
ARM_TOP = 0.60
X_SIDE = WIDTH / 2 - ARM_W / 2
LEG_W, LEG_T = 0.045, 0.035  # in the side plane, across it
FRONT_FOOT_Y, FRONT_TOP_Y = -DEPTH / 2 + 0.023, -0.285  # front legs lean back as they rise
REAR_FOOT_Y, REAR_TOP_Y = DEPTH / 2 - 0.023, 0.25  # rear legs splay backward
RAIL_Z, RAIL_H, RAIL_T = 0.30, 0.07, 0.03  # side rails and aprons (center, height, thickness)
STRAP_RAIL_Z, STRAP_RAIL = 0.545, 0.022  # rail under the armrest the straps loop over

# Back frame: two posts reclined backward, a top board, straps between board and apron.
BACK_POST_X = X_SIDE - 0.05
BACK_BOTTOM = (0.30, 0.30)  # (y, z), inside the rear apron
BACK_TOP = (0.37, 0.775)
BACK_BOARD_W = 0.05

STRAP_W, STRAP_T, STRAP_PITCH = 0.042, 0.0025, 0.056

CUSHION_BOTTOM = RAIL_Z + RAIL_H / 2
WELT_RADIUS = 0.003


class Params:
    """Cushion sizes corrected after measuring (subdivision shrinks them)."""

    seat_top = SEAT_HEIGHT
    back_center = 0.24  # back cushion center, measured along the back posts from BACK_BOTTOM


P = Params()

LINEN_TILE_M = 0.10
# Average linen color (sRGB), from the product photo: lit seat top ~(225,218,203), front
# face in shade ~(205,190,165). A warm natural linen; the texture averages to exactly this.
LINEN_COLOR = (214 / 255, 205 / 255, 189 / 255)
WOOD_ALONG_M, WOOD_ACROSS_M = 0.60, 0.15  # wood texture coverage (grain runs along)
# Honey hardwood (freijo/teak-like), satin finish: lit armrest ~(205,135,70), legs ~(180,110,55).
WOOD_COLOR = (176 / 255, 112 / 255, 58 / 255)


# --- Textures -----------------------------------------------------------------------------


def linen_images(directory, size=2048, threads=128, seed=21):
    """Tileable linen plain weave (~0.8 mm threads) with slubs: each thread thickens and
    lightens irregularly along its length, the signature of real linen. Weft a touch lighter
    than warp. Tones vary along threads and per crossing, never per whole thread (plaid)."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:size, 0:size].astype(np.float32) / size
    fx, fy = (x * threads) % 1.0, (y * threads) % 1.0
    ix, iy = np.floor(x * threads).astype(int), np.floor(y * threads).astype(int)
    over = (ix + iy) % 2 == 0
    px = np.arange(size)

    def slubs():
        # One smooth random profile along each thread (blurred along its length, wrapped).
        s = rng.normal(0, 1, (threads, size)).astype(np.float32)
        for _ in range(40):
            s = (s + np.roll(s, 1, 1) + np.roll(s, -1, 1)) / 3
        return mk.normalize(s)

    warp_slub = slubs()[ix, np.broadcast_to(px[:, None], (size, size))]
    weft_slub = slubs()[iy, np.broadcast_to(px[None, :], (size, size))]
    warp = np.sin(np.pi * fx) ** (0.5 / (1 + 0.3 * np.clip(warp_slub, -1.5, 3)))
    weft = np.sin(np.pi * fy) ** (0.5 / (1 + 0.3 * np.clip(weft_slub, -1.5, 3)))
    height = np.where(over, 0.45 + 0.55 * warp * (0.55 + 0.45 * np.sin(np.pi * fy)),
                      0.45 + 0.55 * weft * (0.55 + 0.45 * np.sin(np.pi * fx)))

    crossing = rng.normal(0, 1, (threads, threads))[iy, ix]
    tone = np.where(over, 0.03 * warp_slub, 0.02 + 0.03 * weft_slub) + 0.012 * crossing
    shade = 0.82 + 0.18 * height + tone + rng.normal(0, 0.01, (size, size))
    color = np.array(LINEN_COLOR, dtype=np.float32) * np.stack([shade, shade ** 1.05, shade ** 1.12], axis=2)
    color = mk.match_mean(color, LINEN_COLOR, "linen")

    color_img = mk.save_image("linen_color", color, os.path.join(directory, "linen_color.jpg"), "JPEG", "sRGB")
    normal_img = mk.save_image("linen_normal", mk.normal_from_height(height, 1.2),
                               os.path.join(directory, "linen_normal.jpg"), "JPEG", "Non-Color")
    return color_img, normal_img


def wood_images(directory, along=2048, across=512, seed=8):
    """Tileable straight-grained hardwood: rows run along the grain (v), columns across it
    (u). Wavering growth lines at two spacings, broad early/latewood bands, a slow tone drift
    along the board and fine dark pores streaked along the grain."""
    rng = np.random.default_rng(seed)
    v, u = np.mgrid[0:along, 0:across].astype(np.float32)
    u, v = u / across, v / along

    def wander(amps):
        return sum(a * np.sin(2 * np.pi * k * v + rng.uniform(0, 2 * np.pi)) for k, a in amps)

    # Gentle wander only: stronger warps read as swirly zebrawood/plywood, not the straight
    # grain of the reference.
    warp = wander(((1, 0.012), (2, 0.006), (3, 0.003), (5, 0.002)))
    lines = (0.5 + 0.5 * np.sin(2 * np.pi * 24 * (u + warp))) ** 4
    fine = (0.5 + 0.5 * np.sin(2 * np.pi * (37 * (u + 0.7 * warp)) + 1.0)) ** 6
    bands = 0.5 + 0.5 * np.sin(2 * np.pi * 7 * (u + warp))
    drift = wander(((1, 1.0), (2, 0.5), (3, 0.25))) / 1.75
    pores = mk.normalize(mk.streaks(rng.normal(0, 1, (along, across)).astype(np.float32), np.pi / 2, 6))
    pores = np.clip(-pores - 1.6, 0, None)  # sparse dark specks, elongated along the grain

    shade = 1.0 - 0.05 * bands - 0.06 * lines - 0.03 * fine + 0.04 * drift - 0.2 * pores
    color = np.array(WOOD_COLOR, dtype=np.float32) * np.stack([shade, shade ** 1.1, shade ** 1.25], axis=2)
    color = mk.match_mean(color, WOOD_COLOR, "wood")

    color_img = mk.save_image("wood_color", color, os.path.join(directory, "wood_color.jpg"), "JPEG", "sRGB")
    normal_img = mk.save_image("wood_normal", mk.normal_from_height(-0.4 * lines - pores, 0.6),
                               os.path.join(directory, "wood_normal.jpg"), "JPEG", "Non-Color")
    return color_img, normal_img


# --- Materials ----------------------------------------------------------------------------


def linen_material(color_img, normal_img):
    mat, bsdf = mk.textured_material("Linen", color_img, normal_img, normal_strength=0.5, roughness=0.9)
    # Soft fuzz at grazing angles (exported as KHR_materials_sheen).
    mk.sheen(bsdf, weight=0.25, tint=(1.0, 0.97, 0.92), roughness=0.6)
    return mat


def wood_material(color_img, normal_img):
    mat, bsdf = mk.textured_material("Wood", color_img, normal_img, normal_strength=0.3, roughness=0.55)
    # Thin oiled/satin finish over the grain (exported as KHR_materials_clearcoat).
    mk.clearcoat(bsdf, weight=0.5, roughness=0.3)
    return mat


# --- Parts --------------------------------------------------------------------------------

RNG = np.random.default_rng(1)


def board(name, start, end, width_hint, width, thickness, material, level_ends=False):
    """Rectangular wooden member from start to end. `width` lies along `width_hint` (made
    perpendicular to the member), `thickness` across both. Grain runs along the member;
    each board gets its own texture offset. With `level_ends`, both ends are cut level
    (horizontal), for legs standing on the floor and meeting the armrest."""
    start, end = np.array(start, dtype=float), np.array(end, dtype=float)
    a = (end - start) / np.linalg.norm(end - start)
    w = np.array(width_hint, dtype=float)
    w = w - a * np.dot(w, a)
    w /= np.linalg.norm(w)
    t = np.cross(a, w)
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    verts = []
    for p in (start, end):
        for cw, ct in corners:
            q = p + w * cw * width / 2 + t * ct * thickness / 2
            if level_ends:
                q = q - a * ((q[2] - p[2]) / a[2])
            verts.append(tuple(q))
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    obj = mk.mesh_object(name, verts, faces, material)
    obj.data.update()

    # Grain along the member: side faces map (across, along); end faces show end grain.
    du, dv = RNG.uniform(0, 1, 2)
    layer = obj.data.uv_layers.new(name="UVMap")
    for poly in obj.data.polygons:
        n = np.array(poly.normal)
        for li in poly.loop_indices:
            co = np.array(obj.data.vertices[obj.data.loops[li].vertex_index].co) - start
            s, qw, qt = np.dot(co, a), np.dot(co, w), np.dot(co, t)
            if abs(np.dot(n, a)) > 0.7:
                uv = (qw / WOOD_ACROSS_M, qt / WOOD_ACROSS_M)
            elif abs(np.dot(n, w)) > abs(np.dot(n, t)):
                uv = (qt / WOOD_ACROSS_M, s / WOOD_ALONG_M)
            else:
                uv = (qw / WOOD_ACROSS_M, s / WOOD_ALONG_M)
            layer.data[li].uv = (uv[0] + du, uv[1] + dv)

    bevel = obj.modifiers.new("Bevel", "BEVEL")
    bevel.width = 0.003
    bevel.segments = 2
    bevel.limit_method = "NONE"
    bevel.harden_normals = True
    return obj


def strap(name, bottom, top, normal, width_axis, rail_radius, material):
    """Webbing strap looped over the rail at `top` (its center) and anchored at `bottom`
    (inside the lower rail). A closed thin band: up the outer side, over the rail, down the
    inner side, closed inside the lower rail."""
    bottom, top = np.array(bottom, dtype=float), np.array(top, dtype=float)
    n, wa = np.array(normal, dtype=float), np.array(width_axis, dtype=float)
    d = (top - bottom) / np.linalg.norm(top - bottom)
    length = float(np.linalg.norm(top - bottom))
    r = rail_radius + STRAP_T / 2
    path = [(r, 0.0), (r, length)]
    path += [(r * math.cos(th), length + r * math.sin(th)) for th in np.linspace(0, math.pi, 13)[1:-1]]
    path += [(-r, length), (-r, 0.0)]
    pts2 = np.array(path)  # straight runs need no points in between, only the bend does

    verts, uvs, faces = [], [], []
    m = len(pts2)
    s_acc = 0.0
    for i, (pa, pb) in enumerate(pts2):
        prev, nxt = pts2[i - 1], pts2[(i + 1) % m]
        tan = np.array(nxt) - np.array(prev)
        tan /= np.linalg.norm(tan)
        off = np.array([tan[1], -tan[0]])  # in-plane normal of the path
        if i:
            s_acc += float(np.linalg.norm(pts2[i] - pts2[i - 1]))
        for ct, cw in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            a2 = pa + off[0] * ct * STRAP_T / 2
            b2 = pb + off[1] * ct * STRAP_T / 2
            verts.append(tuple(bottom + n * a2 + d * b2 + wa * cw * STRAP_W / 2))
            uvs.append((cw * STRAP_W / 2 / LINEN_TILE_M, s_acc / LINEN_TILE_M))
    for i in range(m):
        a, b = 4 * i, 4 * ((i + 1) % m)
        for k in range(4):
            k2 = (k + 1) % 4
            faces.append((a + k, b + k, b + k2, a + k2))
    obj = mk.mesh_object(name, verts, faces, material)
    layer = obj.data.uv_layers.new(name="UVMap")
    for poly in obj.data.polygons:
        for li, vi in zip(poly.loop_indices, poly.vertices):
            layer.data[li].uv = uvs[vi]
    # Flat webbing: sharp along its four long edges (smoothing across the thin edges made the
    # straps shade like round tubes).
    sharp = obj.data.attributes.new("sharp_edge", "BOOLEAN", "EDGE")
    for e in obj.data.edges:
        a, b = e.vertices
        if a % 4 == b % 4:
            sharp.data[e.index].value = True
    return obj


def leg_y(foot_y, top_y, z):
    return foot_y + (top_y - foot_y) * z / (ARM_TOP - ARM_T)


def build_frame(wood, linen):
    parts = []
    leg_top = ARM_TOP - ARM_T + 0.008  # a little into the armrest
    for side in (1, -1):
        x = side * X_SIDE
        tag = "R" if side > 0 else "L"
        parts.append(board(f"FrontLeg{tag}", (x, FRONT_FOOT_Y, 0.0), (x, FRONT_TOP_Y, leg_top),
                           (0, 1, 0), LEG_W, LEG_T, wood, level_ends=True))
        parts.append(board(f"RearLeg{tag}", (x, REAR_FOOT_Y, 0.0), (x, REAR_TOP_Y, leg_top),
                           (0, 1, 0), LEG_W, LEG_T, wood, level_ends=True))
        parts.append(board(f"Armrest{tag}", (x, FRONT_TOP_Y - 0.05, ARM_TOP - ARM_T / 2),
                           (x, REAR_TOP_Y + 0.05, ARM_TOP - ARM_T / 2), (1, 0, 0), ARM_W, ARM_T, wood))
        rail_y0, rail_y1 = leg_y(FRONT_FOOT_Y, FRONT_TOP_Y, RAIL_Z), leg_y(REAR_FOOT_Y, REAR_TOP_Y, RAIL_Z)
        parts.append(board(f"SideRail{tag}", (x, rail_y0, RAIL_Z), (x, rail_y1, RAIL_Z),
                           (0, 0, 1), RAIL_H, RAIL_T, wood))
        sr_y0 = leg_y(FRONT_FOOT_Y, FRONT_TOP_Y, STRAP_RAIL_Z)
        sr_y1 = leg_y(REAR_FOOT_Y, REAR_TOP_Y, STRAP_RAIL_Z)
        parts.append(board(f"StrapRail{tag}", (x, sr_y0, STRAP_RAIL_Z), (x, sr_y1, STRAP_RAIL_Z),
                           (0, 0, 1), STRAP_RAIL, STRAP_RAIL, wood))
        # Side straps between the legs.
        span0, span1 = sr_y0 + LEG_W / 2 + 0.012, sr_y1 - LEG_W / 2 - 0.012
        count = int((span1 - span0 + STRAP_PITCH - STRAP_W) / STRAP_PITCH)
        first = (span0 + span1) / 2 - (count - 1) * STRAP_PITCH / 2
        for i in range(count):
            y = first + i * STRAP_PITCH
            parts.append(strap(f"SideStrap{tag}{i}", (x, y, RAIL_Z), (x, y, STRAP_RAIL_Z),
                               (side, 0, 0), (0, 1, 0), STRAP_RAIL / 2, linen))

    # Aprons between the legs, front and back.
    for tag, foot_y, top_y in (("Front", FRONT_FOOT_Y, FRONT_TOP_Y), ("Rear", REAR_FOOT_Y, REAR_TOP_Y)):
        y = leg_y(foot_y, top_y, RAIL_Z)
        parts.append(board(f"{tag}Apron", (-X_SIDE, y, RAIL_Z), (X_SIDE, y, RAIL_Z),
                           (0, 0, 1), RAIL_H, RAIL_T, wood))

    # Back: reclined posts, a top board and vertical straps.
    (by, bz), (ty, tz) = BACK_BOTTOM, BACK_TOP
    d = np.array([0.0, ty - by, tz - bz])
    d /= np.linalg.norm(d)
    n_front = np.cross([1.0, 0.0, 0.0], d)  # back plane normal, pointing forward
    for side in (1, -1):
        x = side * BACK_POST_X
        parts.append(board(f"BackPost{'R' if side > 0 else 'L'}", (x, by, bz), (x, ty, tz),
                           (1, 0, 0), 0.04, 0.03, wood))
    board_center = np.array([0.0, ty, tz]) - d * BACK_BOARD_W / 2
    parts.append(board("BackBoard", board_center + [-BACK_POST_X - 0.02, 0, 0],
                       board_center + [BACK_POST_X + 0.02, 0, 0], d, BACK_BOARD_W, 0.03, wood))
    span = 2 * (BACK_POST_X - 0.02) - STRAP_W
    count = int(span / STRAP_PITCH) + 1
    for i in range(count):
        x = -(count - 1) * STRAP_PITCH / 2 + i * STRAP_PITCH
        parts.append(strap(f"BackStrap{i}", (x, by, bz + 0.01), tuple(board_center + [x, 0, 0]),
                           n_front, (1, 0, 0), 0.015, linen))
    return parts, d, n_front


def build_seat_cushion(linen):
    """Box cushion on the rails, flush with the front apron; piped top and bottom edges."""
    x_half = X_SIDE - 0.032
    y0 = leg_y(FRONT_FOOT_Y, FRONT_TOP_Y, RAIL_Z) - RAIL_T / 2 - 0.006
    y1 = BACK_BOTTOM[0] - 0.01
    seat = mk.pillow("SeatCushion", x_half, (y0, y1), (CUSHION_BOTTOM - 0.004, P.seat_top), linen,
                     exp_h=6.0, exp_v=6.0, tile=LINEN_TILE_M, crown=0.06, cuts=12)
    welts = []
    for tag, z in (("Top", P.seat_top + 0.01), ("Bottom", CUSHION_BOTTOM - 0.014)):
        guide = []
        for phi in np.linspace(0, 2 * math.pi, 160, endpoint=False):
            gx, gy = mk.superellipse(phi, x_half + 0.01, (y1 - y0) / 2 + 0.01, 6.0)
            guide.append((gx, (y0 + y1) / 2 + gy, z))
        welts.append(mk.welt(f"WeltSeat{tag}", guide, seat, WELT_RADIUS, linen, LINEN_TILE_M, closed=True))
    return seat, welts, (x_half, y0, y1)


def build_back_cushion(linen, d, n_front):
    """Plump knife-edge pillow leaning on the back straps; piped around its edge."""
    width, height, thick = 2 * (X_SIDE - 0.04), 0.44, 0.17
    cushion = mk.pillow("BackCushion", width / 2, (-height / 2, height / 2), (-thick / 2, thick / 2), linen,
                        exp_h=4.0, exp_v=2.6, tile=LINEN_TILE_M, crown=0.12, cuts=12)
    # Local x -> world x, local y (height) -> along the posts, local z (crowned face) -> forward.
    forward = n_front
    origin = (np.array([0.0, *BACK_BOTTOM]) + d * P.back_center
              + forward * (thick / 2 + STRAP_T + 0.02))
    frame = Matrix(((1, 0, 0, origin[0]),
                    (0, d[1], forward[1], origin[1]),
                    (0, d[2], forward[2], origin[2]),
                    (0, 0, 0, 1)))
    cushion.data.transform(frame)
    guide = []
    for phi in np.linspace(0, 2 * math.pi, 160, endpoint=False):
        gx, gy = mk.superellipse(phi, width / 2 + 0.01, height / 2 + 0.01, 4.0)
        guide.append(tuple(frame @ Vector((gx, gy, 0.0))))
    welt = mk.welt("WeltBack", guide, cushion, WELT_RADIUS, linen, LINEN_TILE_M, closed=True)
    return cushion, welt


# --- Surface detail -----------------------------------------------------------------------


def seat_sag(mesh, x_half, y0, y1, depth=0.008):
    """Soft dip in the seat cushion where people sit."""
    co, nor = mk.vertex_arrays(mesh)
    on_top = (nor[:, 2] > 0.6) & (np.abs(co[:, 2] - P.seat_top) < 0.03)
    u = co[:, 0] / (0.85 * x_half)
    v = (co[:, 1] - ((y0 + y1) / 2 + 0.03)) / (0.85 * (y1 - y0) / 2)
    co[:, 2] -= depth * np.clip(1 - u * u - v * v, 0, None) ** 2 * on_top
    mesh.vertices.foreach_set("co", co.ravel())
    mesh.update()


def finish(seat, back, welts, seat_box):
    """Seat sag and stitching puckers on the cushions, then everything joined into one mesh
    without its hidden faces, ready for the AO bake."""
    cushions = mk.join_applied([seat, back], "Cushions")
    seat_sag(cushions.data, *seat_box)
    mk.seam_puckers(cushions.data, welts, seed=4)
    rest = [o for o in bpy.context.scene.objects if o.type == "MESH" and o is not cushions]
    chair = mk.join_applied([cushions] + rest, "Chair")
    mk.remove_hidden_faces(chair)
    return chair


# --- Build --------------------------------------------------------------------------------


def main():
    directory = mk.out_dir()
    build_dir = os.path.join(directory, "_build")
    os.makedirs(build_dir, exist_ok=True)
    mk.reset_scene()
    linen = linen_material(*linen_images(build_dir))
    wood = wood_material(*wood_images(build_dir))

    # Build, measure, correct the cushions (subdivision shrinks them; the frame is exact).
    for attempt in range(8):
        RNG.bit_generator.state = np.random.default_rng(1).bit_generator.state  # same boards
        mk.clear_objects()
        _, d, n_front = build_frame(wood, linen)
        seat, seat_welts, seat_box = build_seat_cushion(linen)
        back, back_welt = build_back_cushion(linen, d, n_front)
        mins, maxs, tris = mk.evaluated_bounds()
        _, seat_max, _ = mk.evaluated_bounds([seat])
        errors = {"height": HEIGHT - maxs[2], "seat": SEAT_HEIGHT - seat_max[2]}
        print(f"REPORT attempt {attempt}: " + ", ".join(f"{k}={v * 1000:+.1f}mm" for k, v in errors.items()))
        if all(abs(e) <= mk.SIZE_TOLERANCE_M for e in errors.values()):
            break
        P.back_center += errors["height"] / d[2]
        P.seat_top += errors["seat"]

    mk.check_and_report(mins, maxs, tris, seat_max[2])
    chair = finish(seat, back, seat_welts + [back_welt], seat_box)
    # AO at 1K: it is soft, low-frequency shading; 2K only added ~0.7 MB.
    mk.bake_ao(chair, os.path.join(build_dir, "chair_ao.jpg"), size=1024)
    mk.export(directory)
    mk.render_previews(directory, build_dir, distance=2.4, target_z=0.40)
    print("REPORT done")


main()
