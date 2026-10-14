"""
Framed painting (wall art), built procedurally in Blender.

Run (no UI needed):
    blender -b --factory-startup --python tools/models/framed_painting.py -- <output_dir>

Writes to <output_dir>: model.glb, model.usdz, thumbnail.jpg; and to <output_dir>/_build/
the generated textures and preview renders (git-ignored). Model rules (CLAUDE.md 4.5):
meters, real size, Y-up in the exported files, PBR materials, 2K textures max, <= 5 MB.

Wall art (category `wall-art`): the origin is the **center of the back face** (the point
that touches the wall), not the bottom center (CLAUDE.md 4.5). In the catalog as
`prod-art-knights`.

Blender is Z-up; the glTF exporter converts to Y-up. The painting faces Blender -Y (glTF +Z)
with its back on the y = 0 plane (glTF z = 0).

The artwork comes from a phone photo of the painting (sources/knights_painting_photo.png),
perspective-corrected onto the canvas. The photo is low resolution (the painting covers about
360 x 480 px of it), so the canvas looks soft up close; replace SOURCE_PHOTO and
CANVAS_CORNERS with a straight-on, high-resolution image of the artwork (from the retailer,
who holds the reproduction rights) for production.
"""

import os
import sys

import bmesh
import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import modelkit as mk  # noqa: E402

# --- Real dimensions (meters), estimated: the size isn't known ----------------------------
WIDTH = 1.20  # outside of the frame
HEIGHT = 0.90
FRAME_FACE = 0.022  # visible width of the frame's front face
FRAME_DEPTH = 0.045  # wall to frame front
CANVAS_DEPTH = 0.040  # wall to canvas front: the frame stands 5 mm proud of it
CANVAS_GAP = 0.003  # shadow line between canvas and frame

# --- Artwork source -----------------------------------------------------------------------
SOURCE_PHOTO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sources", "knights_painting_photo.png")
# Canvas corners in the photo (pixels; inside the frame): top-left, top-right, bottom-right,
# bottom-left. Measured on a zoomed grid, pulled ~2 px inward to keep the frame out.
CANVAS_CORNERS = [(62, 30), (416, 258), (416, 533), (62, 503)]
# Red tape on the bottom-right corner of the canvas (rectified texture, fractions of width
# and height: x0, x1, y0, y1). Filled in from the sky just above it.
TAPE_BOXES = [(0.70, 0.83, 0.88, 1.0), (0.0, 0.04, 0.95, 1.0)]
TEXTURE_WIDTH = 1024  # the photo has ~360 px of artwork across; more would add only size

WEAVE_TILE_M = 0.03  # canvas weave under the paint


# --- Textures -----------------------------------------------------------------------------


def load_photo(path):
    """Image as HxWx3 floats (sRGB values), top row first."""
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, img.channels)[..., :3]
    bpy.data.images.remove(img)
    return np.flipud(px)  # Blender stores the bottom row first


def homography(src, dst):
    """3x3 matrix mapping the 4 `src` points onto the 4 `dst` points."""
    rows, rhs = [], []
    for (x, y), (u, v) in zip(src, dst):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        rhs += [u, v]
    h = np.linalg.solve(np.array(rows, dtype=float), np.array(rhs, dtype=float))
    return np.append(h, 1.0).reshape(3, 3)


def rectify(photo, corners, width, height):
    """Perspective-corrects the canvas quad into a width x height image (bilinear)."""
    rect = [(0, 0), (width - 1, 0), (width - 1, height - 1), (0, height - 1)]
    to_photo = homography(rect, corners)
    v, u = np.mgrid[0:height, 0:width].astype(np.float64)
    pts = to_photo @ np.stack([u.ravel(), v.ravel(), np.ones(u.size)])
    x, y = pts[0] / pts[2], pts[1] / pts[2]
    x0 = np.clip(np.floor(x).astype(int), 0, photo.shape[1] - 2)
    y0 = np.clip(np.floor(y).astype(int), 0, photo.shape[0] - 2)
    fx, fy = (x - x0)[:, None], (y - y0)[:, None]
    out = (photo[y0, x0] * (1 - fx) * (1 - fy) + photo[y0, x0 + 1] * fx * (1 - fy)
           + photo[y0 + 1, x0] * (1 - fx) * fy + photo[y0 + 1, x0 + 1] * fx * fy)
    return out.reshape(height, width, 3)


def remove_tape(img):
    """Paints out the tape inside TAPE_BOXES: pink pixels plus its pale highlights, grown a
    little, then filled row by row by interpolating between the clean pixels left and right
    (the sky there is a vertical gradient, so each row is nearly uniform)."""
    h, w, _ = img.shape
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    tape = ((r > 0.45) & (r - (g + b) / 2 > 0.12)) | (r > 0.62)
    filled = 0
    for x0, x1, y0, y1 in TAPE_BOXES:
        c0, c1, r0, r1 = int(x0 * w), int(x1 * w), int(y0 * h), int(y1 * h)
        box = np.zeros_like(tape)
        box[r0:r1, c0:c1] = True
        mask = tape & box
        for _ in range(4):  # catch the soft edges
            mask = (mask | np.roll(mask, 1, 0) | np.roll(mask, -1, 0) | np.roll(mask, 1, 1) | np.roll(mask, -1, 1)) & box
        for row in range(r0, r1):
            cols = np.where(mask[row])[0]
            if not len(cols):
                continue
            left, right = max(cols.min() - 1, 0), min(cols.max() + 1, w - 1)
            t = ((cols - left) / max(right - left, 1))[:, None]
            img[row, cols] = img[row, left] * (1 - t) + img[row, right] * t
            filled += len(cols)
    print(f"REPORT tape pixels filled: {filled}")
    return img


def canvas_images(directory):
    height = round(TEXTURE_WIDTH * (HEIGHT - 2 * FRAME_FACE) / (WIDTH - 2 * FRAME_FACE))
    art = rectify(load_photo(SOURCE_PHOTO), CANVAS_CORNERS, TEXTURE_WIDTH, height)
    art = np.clip(remove_tape(art), 0, 1)
    art_img = mk.save_image("artwork", np.flipud(art).copy(), os.path.join(directory, "artwork.jpg"), "JPEG", "sRGB")

    # Canvas weave under the paint: a fine plain weave, softened (the paint fills it).
    size, threads = 1024, 60  # 0.5 mm threads over 3 cm
    y, x = np.mgrid[0:size, 0:size].astype(np.float32) / size
    fx, fy = (x * threads) % 1.0, (y * threads) % 1.0
    over = (np.floor(x * threads) + np.floor(y * threads)) % 2 == 0
    height_field = np.where(over, np.sin(np.pi * fx) * (0.5 + 0.5 * np.sin(np.pi * fy)),
                            np.sin(np.pi * fy) * (0.5 + 0.5 * np.sin(np.pi * fx)))
    height_field = mk.blur_wrap(height_field.astype(np.float32), 2)
    weave_img = mk.save_image("canvas_weave", mk.normal_from_height(height_field, 1.5),
                              os.path.join(directory, "canvas_weave.jpg"), "JPEG", "Non-Color")
    print(f"REPORT artwork texture {TEXTURE_WIDTH}x{height}")
    return art_img, weave_img


# --- Materials ----------------------------------------------------------------------------


def paint_material(art_img, weave_img):
    """Artwork on the art UVs; the weave normal map tiles on its own UV map."""
    mat, bsdf = mk.principled("Painting")
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    art_uv = nodes.new("ShaderNodeUVMap")
    art_uv.uv_map = "UVMap"
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = art_img
    tex.extension = "EXTEND"  # the wrapped canvas edges reuse the outermost pixels
    links.new(art_uv.outputs["UV"], tex.inputs["Vector"])
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    weave_uv = nodes.new("ShaderNodeUVMap")
    weave_uv.uv_map = "WeaveUV"
    ntex = nodes.new("ShaderNodeTexImage")
    ntex.image = weave_img
    links.new(weave_uv.outputs["UV"], ntex.inputs["Vector"])
    nmap = nodes.new("ShaderNodeNormalMap")
    nmap.inputs["Strength"].default_value = 0.25
    links.new(ntex.outputs["Color"], nmap.inputs["Color"])
    links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 0.55  # acrylic/oil with a satin varnish
    return mat


def frame_material():
    mat, bsdf = mk.principled("BlackFrame")
    bsdf.inputs["Base Color"].default_value = (0.012, 0.012, 0.012, 1)
    bsdf.inputs["Roughness"].default_value = 0.4  # satin black lacquer
    return mat


# --- Parts --------------------------------------------------------------------------------


def outward_normals(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()


def build_frame(material):
    """Rectangular ring: outer W x H, inner opening W - 2*FRAME_FACE, from the wall (y = 0)
    to FRAME_DEPTH in front. Mitered corners are implicit (one continuous ring)."""
    ox, oz = WIDTH / 2, HEIGHT / 2
    ix, iz = ox - FRAME_FACE, oz - FRAME_FACE
    rect = lambda hx, hz: [(-hx, -hz), (hx, -hz), (hx, hz), (-hx, hz)]  # noqa: E731
    verts = []
    for y in (0.0, -FRAME_DEPTH):
        verts += [(x, y, z) for x, z in rect(ox, oz)]  # outer ring
        verts += [(x, y, z) for x, z in rect(ix, iz)]  # inner ring
    # Indices: back outer 0-3, back inner 4-7, front outer 8-11, front inner 12-15.
    faces = []
    for k in range(4):
        k2 = (k + 1) % 4
        faces.append((8 + k, 8 + k2, 12 + k2, 12 + k))  # front face
        faces.append((0 + k2, 0 + k, 4 + k, 4 + k2))  # back face
        faces.append((0 + k, 0 + k2, 8 + k2, 8 + k))  # outer side
        faces.append((4 + k2, 4 + k, 12 + k, 12 + k2))  # inner side
    obj = mk.mesh_object("Frame", verts, faces, material)
    outward_normals(obj)
    mk.box_uvs(obj, 0.1)
    bevel = obj.modifiers.new("Bevel", "BEVEL")
    bevel.width = 0.0015
    bevel.segments = 2
    bevel.limit_method = "NONE"
    bevel.harden_normals = True
    return obj


def build_canvas(material):
    """Stretched canvas: a box whose front shows the artwork and whose sides wrap its edge
    colors (gallery wrap). Second UV map tiles the weave."""
    hx = WIDTH / 2 - FRAME_FACE - CANVAS_GAP
    hz = HEIGHT / 2 - FRAME_FACE - CANVAS_GAP
    y_back, y_front = -0.004, -CANVAS_DEPTH
    verts = [(x, y, z) for y in (y_back, y_front) for x, z in ((-hx, -hz), (hx, -hz), (hx, hz), (-hx, hz))]
    faces = [(4, 5, 6, 7), (3, 2, 1, 0), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    obj = mk.mesh_object("Canvas", verts, faces, material, smooth=False)
    outward_normals(obj)
    mesh = obj.data
    art, weave = mesh.uv_layers.new(name="UVMap"), mesh.uv_layers.new(name="WeaveUV")
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            x, y, z = mesh.vertices[mesh.loops[li].vertex_index].co
            # Front and back: the artwork; sides: the same UV as the nearest front edge
            # (EXTEND stretches the edge pixels around the stretcher).
            art.data[li].uv = ((x + hx) / (2 * hx), (z + hz) / (2 * hz))
            weave.data[li].uv = ((x + 0.37 * y) / WEAVE_TILE_M, (z + 0.53 * y) / WEAVE_TILE_M)
    return obj


# --- Checks, previews ---------------------------------------------------------------------


def check_wall_origin():
    mins, maxs, tris = mk.evaluated_bounds()
    size = maxs - mins
    if abs(mins[0] + maxs[0]) > 1e-4 or abs(mins[2] + maxs[2]) > 1e-4 or abs(maxs[1]) > 1e-4:
        raise SystemExit(f"Origin is not at the back center: min={mins} max={maxs}")
    print(f"REPORT size_m width={size[0]:.3f} height={size[2]:.3f} depth={size[1]:.3f} triangles={tris}")


def render_wall_previews(directory, build_dir, hang_z=1.45):
    """Hangs the painting on a wall at eye height and renders front, angle, close-up and the
    catalog thumbnail."""
    for obj in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
        obj.location.z += hang_z
    cam = mk.setup_preview(exposure=-2.1)
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0.0005, 2.0), rotation=(np.pi / 2, 0, 0))
    wall = bpy.context.active_object
    wall_mat, bsdf = mk.principled("Wall")
    bsdf.inputs["Base Color"].default_value = (0.5, 0.48, 0.45, 1)
    bsdf.inputs["Roughness"].default_value = 0.9
    wall.data.materials.append(wall_mat)

    center = (0, 0, hang_z)
    mk.render_from(cam, (0.0, -2.6, hang_z), center, os.path.join(build_dir, "preview_front.png"))
    mk.render_from(cam, (1.7, -1.9, hang_z - 0.1), center, os.path.join(build_dir, "preview_three_quarter.png"))
    mk.render_from(cam, (0.45, -0.75, hang_z - 0.1), (0.3, 0, hang_z - 0.2),
                   os.path.join(build_dir, "preview_detail.png"))
    scene = bpy.context.scene
    scene.render.resolution_x = scene.render.resolution_y = 800
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 88
    mk.render_from(cam, (0.9, -2.3, hang_z), center, os.path.join(directory, "thumbnail.jpg"))


# --- Build --------------------------------------------------------------------------------


def main():
    directory = mk.out_dir()
    build_dir = os.path.join(directory, "_build")
    os.makedirs(build_dir, exist_ok=True)
    mk.reset_scene()
    paint = paint_material(*canvas_images(build_dir))
    build_frame(frame_material())
    build_canvas(paint)
    check_wall_origin()
    mk.export(directory)
    render_wall_previews(directory, build_dir)
    print("REPORT done")


main()
