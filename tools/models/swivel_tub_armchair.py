"""
Swivel tub armchair, built procedurally in Blender.

Run (no UI needed):
    blender -b --factory-startup --python tools/models/swivel_tub_armchair.py -- <output_dir>

Writes to <output_dir>: model.glb, model.usdz, thumbnail.jpg; and to <output_dir>/_build/
the generated textures and preview renders (git-ignored). Model rules (CLAUDE.md 4.5):
meters, real size, Y-up in the exported files, origin at the bottom center, PBR materials,
<= 5 MB.

Blender is Z-up; the glTF exporter converts to Y-up. The chair's front faces Blender -Y,
which becomes glTF +Z (the app turns +Z toward the camera when placing).

Shape reference: product photo of the Sol chair. A closed upholstered tub (shell + deck),
a thick rolled seat cushion that runs in front of the arm ends, and a four-leg spider base
of flat brushed-steel bars meeting at a central hub.
"""

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import modelkit as mk  # noqa: E402

# --- Real dimensions (meters) -------------------------------------------------------------
WIDTH = 0.60
DEPTH = 0.58
HEIGHT = 0.78
SEAT_HEIGHT = 0.47

# Upholstered body: its underside sits on the swivel plate.
BODY_BOTTOM = 0.33

# Shell (back + arms) seen from above: a superellipse arc from one arm front, around the
# back, to the other arm front.
SHELL_EXP = 2.6  # > 2 = squarer than an ellipse
SHELL_THICKNESS = 0.10
SHELL_ARM_END_DEG = 44.0  # how far the arms come forward (degrees below the side axis)
# Cross-section scale of the last rings at each arm front: rounds the arm ends into a
# thick upholstered nose instead of a flat cut.
ARM_END_TAPER = (0.01, 0.40, 0.68, 0.86, 0.95)
ARM_FRONT_TOP = 0.62
SHELL_FLARE = 0.018  # the shell is this much narrower at the bottom than at the top
SHELL_BULGE = 0.008  # outward belly of the outer face, below the top seam
SEAM_CREASE = 0.55  # subdivision crease on the top seam (outer panel meets top panel)

# Seat cushion: a rounded pillow that fills the tub and runs in front of the arm ends.
CUSHION_BOTTOM = 0.385
CUSHION_SIDE_INSET = 0.035  # from the shell's outer side
CUSHION_CROWN = 0.10  # crown of the top, as a fraction of the cushion's half thickness


class Params:
    """Raw construction sizes. Subdivision smoothing shrinks the outer surfaces, so these are
    corrected after measuring until the finished chair matches WIDTH x DEPTH x HEIGHT."""

    shell_a = WIDTH / 2  # outer half width of the shell (at the top)
    shell_b = DEPTH / 2  # outer half depth of the shell (back at +Y)
    back_top = HEIGHT  # top of the backrest
    seat_front = -DEPTH / 2  # front edge of the seat cushion (front at -Y)
    seat_top = SEAT_HEIGHT  # top of the cushion crown


P = Params()

FABRIC_TILE_M = 0.06  # one texture tile covers 6 cm of fabric
# Average fabric color (sRGB), measured from the product photo: lit seat top ~(223,220,199),
# shaded sides ~(190,182,165). A cool greige; the weave texture averages to exactly this.
FABRIC_COLOR = (204 / 255, 195 / 255, 177 / 255)
# Brushed stainless with the slight warm cast it has in the photo.
METAL_COLOR = (0.66, 0.63, 0.58)


# --- Textures -----------------------------------------------------------------------------


def fabric_images(directory, size=1024, threads=32, seed=7):
    """Tileable heathered plain-weave fabric: base color (sRGB JPEG) and normal map (PNG).

    Each visible thread crossing gets its own tone, mixing light and dark yarns like the
    melange upholstery in the photo. Tones vary per crossing, not per whole thread: whole
    threads of different tone read as a plaid at a distance."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:size, 0:size].astype(np.float32) / size
    fx, fy = (x * threads) % 1.0, (y * threads) % 1.0
    ix, iy = np.floor(x * threads).astype(int), np.floor(y * threads).astype(int)
    over = (ix + iy) % 2 == 0  # which thread is on top in this cell

    # Thread profiles, with a little twist along each thread (the yarn's ply).
    warp = np.sin(np.pi * fx) ** 0.5 * (0.85 + 0.15 * np.sin(2 * np.pi * (fy * 3 + fx)))
    weft = np.sin(np.pi * fy) ** 0.5 * (0.85 + 0.15 * np.sin(2 * np.pi * (fx * 3 + fy)))
    height = np.where(over, 0.45 + 0.55 * warp * (0.55 + 0.45 * np.sin(np.pi * fy)),
                      0.45 + 0.55 * weft * (0.55 + 0.45 * np.sin(np.pi * fx)))

    # Melange: per crossing, a mix of a light and a dark yarn.
    cell_mix = rng.beta(0.6, 1.6, (threads, threads))[iy % threads, ix % threads]
    light = np.array([222, 215, 200], dtype=np.float32) / 255
    dark = np.array([186, 175, 156], dtype=np.float32) / 255
    color = light * (1 - cell_mix[..., None]) + dark * cell_mix[..., None]
    grain = rng.normal(0, 0.015, (size, size))
    color = color * (0.80 + 0.20 * height + grain)[..., None]
    color = mk.match_mean(color, FABRIC_COLOR, "fabric")

    color_img = mk.save_image("fabric_color", color, os.path.join(directory, "fabric_color.jpg"), "JPEG", "sRGB")
    normal_img = mk.save_image("fabric_normal", mk.normal_from_height(height, 2.2),
                               os.path.join(directory, "fabric_normal.png"), "PNG", "Non-Color")
    return color_img, normal_img


# --- Materials ----------------------------------------------------------------------------


def fabric_material(color_img, normal_img):
    mat, bsdf = mk.textured_material("Fabric", color_img, normal_img, normal_strength=0.5, roughness=0.95)
    # Soft fuzz at grazing angles (exported as KHR_materials_sheen).
    mk.sheen(bsdf, weight=0.35, tint=(1.0, 1.0, 1.0), roughness=0.6)
    return mat


def metal_material():
    mat, bsdf = mk.principled("BrushedSteel")
    bsdf.inputs["Base Color"].default_value = (*mk.srgb_to_linear(METAL_COLOR), 1)
    bsdf.inputs["Metallic"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.3
    mk.set_input(bsdf, "Anisotropic", 0.5)
    return mat


def dark_metal_material():
    mat, bsdf = mk.principled("SwivelSteel")
    bsdf.inputs["Base Color"].default_value = (0.05, 0.05, 0.05, 1)
    bsdf.inputs["Metallic"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.45
    return mat


# --- Parts --------------------------------------------------------------------------------


def shell_top(t):
    """Height of the shell rim: level across the back, sloping gently down along the arms.
    t is 0 at the arm fronts and 1 at the back center."""
    k = min(max(t, 0.0) / 0.8, 1.0)
    return ARM_FRONT_TOP + (P.back_top - ARM_FRONT_TOP) * math.sin(k * math.pi / 2) ** 1.4


def build_shell(fabric):
    """Back + arms as one closed tube-like wall; subdivision rounds it like upholstery.

    Each ring is the wall's cross-section: a slightly flared, bellied outer face, a top seam
    (creased edge), and the inner face."""
    samples = 80
    end = math.radians(SHELL_ARM_END_DEG)
    # From the right arm front (-end), around the back (90°), to the left arm front (180°+end).
    phis = [-end + (math.pi + 2 * end) * i / (samples - 1) for i in range(samples)]
    s_end = math.sin(-end)

    verts, faces = [], []
    ring_size = 6
    for phi in phis:
        t = (math.sin(phi) - s_end) / (1 - s_end)
        top = shell_top(t)
        h = top - BODY_BOTTOM
        # (inset from the outer superellipse, height) around the cross-section.
        profile = [
            (SHELL_FLARE, BODY_BOTTOM),  # outer bottom
            (-SHELL_BULGE, BODY_BOTTOM + 0.55 * h),  # outer belly
            (0.0, top - 0.02),  # top seam
            (SHELL_THICKNESS, top),  # inner top
            (SHELL_THICKNESS + 0.006, BODY_BOTTOM + 0.5 * h),  # inner face
            (SHELL_THICKNESS, BODY_BOTTOM),  # inner bottom
        ]
        ring = []
        for inset, z in profile:
            x, y = mk.superellipse(phi, P.shell_a - inset, P.shell_b - inset, SHELL_EXP)
            ring.append((x, y, z))

        # Round the arm ends: shrink the last rings toward their center.
        k = len(verts) // ring_size
        from_end = min(k, samples - 1 - k)
        if from_end < len(ARM_END_TAPER):
            f = ARM_END_TAPER[from_end]
            c = np.mean(ring, axis=0)
            ring = [tuple(c + (np.array(p) - c) * f) for p in ring]
        verts.extend(ring)

    for i in range(samples - 1):
        a, b = ring_size * i, ring_size * (i + 1)
        for k in range(ring_size):
            k2 = (k + 1) % ring_size
            faces.append((a + k, b + k, b + k2, a + k2))
    # No end caps: the first/last rings are shrunk almost to a point (ARM_END_TAPER), which
    # subdivides into a smooth rounded nose; a flat cap showed as a visible patch.

    obj = mk.mesh_object("Shell", verts, faces, fabric)
    # World-scale box projection: arc-length UVs stretched the weave on the tapered arm noses.
    mk.box_uvs(obj, FABRIC_TILE_M)
    # Crease the top seam (ring vertex 2) along the whole wall.
    mk.crease_edges(obj, lambda a, b: a % ring_size == 2 and b % ring_size == 2, SEAM_CREASE)
    mk.add_subsurf(obj, 2)
    return obj


def build_deck(fabric):
    """Upholstered bottom of the tub: closes the underside and shows as a band below the
    cushion at the front."""
    return mk.pillow(
        "Deck",
        x_half=P.shell_a - SHELL_FLARE - 0.03,
        y_range=(P.seat_front + 0.03, P.shell_b - 0.05),
        z_range=(BODY_BOTTOM - 0.004, CUSHION_BOTTOM + 0.02),
        material=fabric,
        exp_h=3.0,
        exp_v=6.0,
        tile=FABRIC_TILE_M,
    )


def build_cushion(fabric):
    """Seat cushion: a thick rolled front, full width in front of the arms; its back and
    sides tuck into the shell."""
    return mk.pillow(
        "SeatCushion",
        x_half=P.shell_a - CUSHION_SIDE_INSET,
        y_range=(P.seat_front, P.shell_b - 0.07),
        z_range=(CUSHION_BOTTOM, P.seat_top),
        material=fabric,
        exp_h=2.8,
        exp_v=2.6,
        tile=FABRIC_TILE_M,
        crown=CUSHION_CROWN,
        cuts=12,
    )


def bar_between(name, top, foot, width, thickness, material):
    """Flat steel bar from top to foot; `width` lies in the bar's vertical plane. The foot
    end is cut level so it stands flat on the floor."""
    top, foot = np.array(top, dtype=float), np.array(foot, dtype=float)
    z = (foot - top) / np.linalg.norm(foot - top)
    side = np.cross(z, [0.0, 0.0, 1.0])
    side /= np.linalg.norm(side)
    x = np.cross(side, z)
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    verts = []
    for cx, cs in corners:
        verts.append(tuple(top + x * cx * width / 2 + side * cs * thickness / 2))
    for cx, cs in corners:
        p = foot + x * cx * width / 2 + side * cs * thickness / 2
        p = p - z * ((p[2] - foot[2]) / z[2])  # slide along the bar onto the foot's level
        verts.append(tuple(p))
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    obj = mk.mesh_object(name, verts, faces, material)
    bevel = obj.modifiers.new("Bevel", "BEVEL")
    bevel.width = 0.0025
    bevel.segments = 3
    bevel.limit_method = "NONE"
    bevel.harden_normals = True
    return obj


def build_base(metal, dark_metal, plastic):
    parts = [
        mk.cylinder("SwivelPlate", 0.085, BODY_BOTTOM - 0.012, BODY_BOTTOM + 0.004, dark_metal),
        mk.cylinder("Hub", 0.03, BODY_BOTTOM - 0.075, BODY_BOTTOM - 0.01, metal),
    ]
    # Four splayed flat-bar legs (X base) meeting in the hub, feet near the footprint corners.
    hub = (0.0, 0.0, BODY_BOTTOM - 0.045)
    foot_x, foot_y, glide_h = WIDTH / 2 - 0.05, DEPTH / 2 - 0.06, 0.004
    for i, (sx, sy) in enumerate([(1, 1), (-1, 1), (-1, -1), (1, -1)]):
        foot = (sx * foot_x, sy * foot_y, glide_h)
        parts.append(bar_between(f"Leg{i}", hub, foot, 0.026, 0.010, metal))
        parts.append(mk.glide(f"Glide{i}", foot[0], foot[1], 0.011, glide_h, plastic))
    return parts


# --- Build --------------------------------------------------------------------------------


def main():
    directory = mk.out_dir()
    build_dir = os.path.join(directory, "_build")
    os.makedirs(build_dir, exist_ok=True)
    mk.reset_scene()
    color_img, normal_img = fabric_images(build_dir)
    fabric = fabric_material(color_img, normal_img)
    metal = metal_material()
    dark_metal = dark_metal_material()
    plastic = mk.plastic_material()

    # Build, measure, correct: smoothing shrinks the shell, so iterate until the real size
    # matches the catalog dimensions (AR shows it 1:1).
    for attempt in range(8):
        mk.clear_objects()
        build_shell(fabric)
        build_deck(fabric)
        cushion = build_cushion(fabric)
        build_base(metal, dark_metal, plastic)
        mins, maxs, tris = mk.evaluated_bounds()
        _, cushion_max, _ = mk.evaluated_bounds([cushion])
        errors = {
            "width": WIDTH / 2 - maxs[0],
            "back": DEPTH / 2 - maxs[1],
            "front": -DEPTH / 2 - mins[1],
            "height": HEIGHT - maxs[2],
            "seat": SEAT_HEIGHT - cushion_max[2],
        }
        print(f"REPORT attempt {attempt}: " + ", ".join(f"{k}={v * 1000:+.1f}mm" for k, v in errors.items()))
        if all(abs(e) <= mk.SIZE_TOLERANCE_M for e in errors.values()):
            break
        P.shell_a += errors["width"]
        P.shell_b += errors["back"]
        P.seat_front += errors["front"]
        P.back_top += errors["height"]
        P.seat_top += errors["seat"]

    mk.check_and_report(mins, maxs, tris, cushion_max[2])
    mk.contact_shadow(build_dir)
    mk.export(directory)
    mk.render_previews(directory, build_dir)
    print("REPORT done")


main()
