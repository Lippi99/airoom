"""
Shared helpers for the procedural furniture scripts in this folder (Blender Python API).

The scripts run as `blender -b --factory-startup --python <script> -- <output_dir>` and
import this module from their own folder. Nothing here is product specific: textures,
shapes and dimensions live in each script.
"""

import math
import os
import sys

import bmesh
import bpy
import numpy as np

SIZE_TOLERANCE_M = 0.002


def out_dir() -> str:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    path = os.path.abspath(argv[0] if argv else "out")
    os.makedirs(path, exist_ok=True)
    return path


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0


def clear_objects():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)
    for curve in list(bpy.data.curves):
        bpy.data.curves.remove(curve)


# --- Textures -----------------------------------------------------------------------------


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def save_image(name, rgb, path, file_format, colorspace):
    """rgb: HxWx3 floats in 0..1 (already in the image's color space)."""
    h, w, _ = rgb.shape
    img = bpy.data.images.new(name, width=w, height=h, alpha=False)
    rgba = np.concatenate([rgb, np.ones((h, w, 1), dtype=np.float32)], axis=2)
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = file_format
    img.save()
    img.colorspace_settings.name = colorspace
    return img


def normal_from_height(height, strength):
    """Tangent-space normal map (OpenGL convention) from a tileable height field."""
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * strength
    n = np.stack([-dx, -dy, np.ones_like(height)], axis=2)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def tileable_noise(rng, size, octaves):
    """Smooth tileable noise in -1..1 from random integer-frequency waves."""
    y, x = np.mgrid[0:size, 0:size].astype(np.float32) / size
    out = np.zeros((size, size), dtype=np.float32)
    for freq, amp in octaves:
        for _ in range(6):
            fx, fy = rng.integers(-freq, freq + 1, 2)
            if fx == 0 and fy == 0:
                continue
            out += amp * np.sin(2 * np.pi * (fx * x + fy * y) + rng.uniform(0, 2 * np.pi))
    return out / (np.abs(out).max() + 1e-6)


def blur_wrap(a, passes):
    """Tileable blur (repeated 3x3 box)."""
    for _ in range(passes):
        for axis in (0, 1):
            a = (a + np.roll(a, 1, axis) + np.roll(a, -1, axis)) / 3
    return a


def normalize(a):
    return (a - a.mean()) / (a.std() + 1e-6)


def streaks(noise, angle, length):
    """Line-integral convolution: averages `noise` along each pixel's direction `angle`
    (radians) over `length` pixels each way, turning it into tileable directional streaks
    (brushed nap, fibers)."""
    h, w = noise.shape
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    dx, dy = np.cos(angle), np.sin(angle)
    acc = noise.copy()
    for k in range(1, length + 1):
        for sign in (1, -1):
            px = (xs + sign * k * dx).astype(np.int64) % w
            py = (ys + sign * k * dy).astype(np.int64) % h
            acc += noise[py, px]
    return acc / (2 * length + 1)


def match_mean(color, target_srgb, label):
    """Scales a texture so it averages to the measured color, and reports it."""
    # float64 means: float32 accumulation over millions of pixels drifts by a few levels.
    color = color * (np.array(target_srgb) / color.reshape(-1, 3).mean(axis=0, dtype=np.float64)).astype(np.float32)
    color = np.clip(color, 0, 1)
    mean_rgb = (color.reshape(-1, 3).mean(axis=0, dtype=np.float64) * 255).round().astype(int).tolist()
    print(f"REPORT {label} mean color sRGB={mean_rgb} target={[round(c * 255) for c in target_srgb]}")
    return color


# --- Materials ----------------------------------------------------------------------------


def principled(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    return mat, bsdf


def set_input(bsdf, name, value):
    """Sets an optional Principled input (names differ between Blender versions)."""
    if name in bsdf.inputs:
        bsdf.inputs[name].default_value = value


def textured_material(name, color_img, normal_img, normal_strength, roughness):
    mat, bsdf = principled(name)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = color_img
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    ntex = nodes.new("ShaderNodeTexImage")
    ntex.image = normal_img
    nmap = nodes.new("ShaderNodeNormalMap")
    nmap.inputs["Strength"].default_value = normal_strength
    links.new(ntex.outputs["Color"], nmap.inputs["Color"])
    links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    return mat, bsdf


def plastic_material():
    mat, bsdf = principled("GlidePlastic")
    bsdf.inputs["Base Color"].default_value = (0.02, 0.02, 0.02, 1)
    bsdf.inputs["Roughness"].default_value = 0.6
    return mat


# --- Geometry -----------------------------------------------------------------------------


def mesh_object(name, verts, faces, material, smooth=True):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(material)
    for p in mesh.polygons:
        p.use_smooth = smooth
    return obj


def box_uvs(obj, tile):
    """World-scale box projection: each face uses the two axes it is most aligned with."""
    mesh = obj.data
    layer = mesh.uv_layers.get("UVMap") or mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        n = poly.normal
        axis = max(range(3), key=lambda i: abs(n[i]))
        for li, vi in zip(poly.loop_indices, poly.vertices):
            co = mesh.vertices[vi].co
            u, v = [co[i] for i in range(3) if i != axis]
            layer.data[li].uv = (u / tile, v / tile)


def add_subsurf(obj, levels=2):
    mod = obj.modifiers.new("Subsurf", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    return mod


def crease_edges(obj, vertex_pairs_filter, value):
    """Subdivision crease on every edge whose two vertices pass the filter."""
    mesh = obj.data
    crease = mesh.attributes.get("crease_edge") or mesh.attributes.new("crease_edge", "FLOAT", "EDGE")
    for e in mesh.edges:
        if vertex_pairs_filter(*e.vertices):
            crease.data[e.index].value = value


def superellipse(phi, a, b, n):
    c, s = math.cos(phi), math.sin(phi)
    x = a * math.copysign(abs(c) ** (2 / n), c)
    y = b * math.copysign(abs(s) ** (2 / n), s)
    return x, y


def cube_sphere(cuts):
    """Unit cube surface as a quad grid (equi-angular), for mapping onto rounded solids.
    No poles, so subdivision stays smooth everywhere."""
    verts, faces, index = [], [], {}

    def vid(p):
        key = tuple(round(c, 6) for c in p)
        if key not in index:
            index[key] = len(verts)
            verts.append(p)
        return index[key]

    grid = [math.tan((-1 + 2 * i / cuts) * math.pi / 4) for i in range(cuts + 1)]
    # (normal axis, u axis, v axis) with u x v = +normal.
    for axis, u_axis, v_axis in ((0, 1, 2), (1, 2, 0), (2, 0, 1)):
        for sign in (1, -1):
            ids = []
            for gu in grid:
                row = []
                for gv in grid:
                    p = [0.0, 0.0, 0.0]
                    p[axis], p[u_axis], p[v_axis] = sign, gu, gv
                    row.append(vid(tuple(p)))
                ids.append(row)
            for i in range(cuts):
                for j in range(cuts):
                    quad = (ids[i][j], ids[i + 1][j], ids[i + 1][j + 1], ids[i][j + 1])
                    faces.append(quad if sign > 0 else quad[::-1])
    return np.array(verts), faces


def pillow(name, x_half, y_range, z_range, material, exp_h, exp_v, tile, crown=0.0, cuts=10):
    """Upholstered block: a superellipsoid (exp_h in plan, exp_v in elevation) filling the
    given box, with an optional crowned top."""
    p, faces = cube_sphere(cuts)
    f = (np.abs(p[:, 0]) ** exp_h + np.abs(p[:, 1]) ** exp_h) ** (exp_v / exp_h) + np.abs(p[:, 2]) ** exp_v
    q = p / (f ** (1 / exp_v))[:, None]
    # Crown: the top rises toward the middle, like a filled cushion.
    top = np.clip(q[:, 2], 0, None)
    q[:, 2] += crown * top * (1 - q[:, 0] ** 2) * (1 - q[:, 1] ** 2)

    z_lo, z_hi = -1.0, 1.0 + crown
    y0, y1 = y_range
    zb, zt = z_range
    verts = np.stack([
        q[:, 0] * x_half,
        y0 + (q[:, 1] + 1) / 2 * (y1 - y0),
        zb + (q[:, 2] - z_lo) / (z_hi - z_lo) * (zt - zb),
    ], axis=1)
    obj = mesh_object(name, [tuple(v) for v in verts], faces, material)
    box_uvs(obj, tile)
    add_subsurf(obj, 2)
    return obj


def resample_polyline(points, spacing, closed=False):
    """Evenly spaced points along a polyline (keeps the ends of an open one)."""
    pts = np.array(points, dtype=float)
    if closed:
        pts = np.vstack([pts, pts[:1]])
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    dist = np.concatenate([[0], np.cumsum(seg)])
    n = max(int(dist[-1] / spacing), 2)
    samples = np.linspace(0, dist[-1], n + 1)
    if closed:
        samples = samples[:-1]
    return np.stack([np.interp(samples, dist, pts[:, i]) for i in range(3)], axis=1)


def welt(name, points, target, radius, material, tile, closed=False):
    """Piping cord along a seam: the guide points are snapped onto the target's smoothed
    surface (shrinkwrap), then swept with a round profile, half sunk into the upholstery."""
    pts = resample_polyline(points, 0.01, closed)
    mesh = bpy.data.meshes.new(name + "Guide")
    edges = [(i, i + 1) for i in range(len(pts) - 1)] + ([(len(pts) - 1, 0)] if closed else [])
    mesh.from_pydata([tuple(p) for p in pts], edges, [])
    guide = bpy.data.objects.new(name + "Guide", mesh)
    bpy.context.scene.collection.objects.link(guide)
    wrap = guide.modifiers.new("Wrap", "SHRINKWRAP")
    wrap.target = target
    wrap.wrap_method = "NEAREST_SURFACEPOINT"
    wrap.offset = radius * 0.3
    deps = bpy.context.evaluated_depsgraph_get()
    ev = guide.evaluated_get(deps)
    snapped = [tuple(v.co) for v in ev.to_mesh().vertices]
    ev.to_mesh_clear()
    bpy.data.objects.remove(guide, do_unlink=True)
    bpy.data.meshes.remove(mesh)

    curve = bpy.data.curves.new(name + "Curve", "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    curve.use_fill_caps = not closed
    spline = curve.splines.new("POLY")
    spline.points.add(len(snapped) - 1)
    for p, co in zip(spline.points, snapped):
        p.co = (*co, 1.0)
    spline.use_cyclic_u = closed
    curve_obj = bpy.data.objects.new(name + "Curve", curve)
    bpy.context.scene.collection.objects.link(curve_obj)
    deps = bpy.context.evaluated_depsgraph_get()
    tube = bpy.data.meshes.new_from_object(curve_obj.evaluated_get(deps))
    bpy.data.objects.remove(curve_obj, do_unlink=True)
    bpy.data.curves.remove(curve)

    obj = bpy.data.objects.new(name, tube)
    bpy.context.scene.collection.objects.link(obj)
    tube.materials.clear()
    tube.materials.append(material)
    for p in tube.polygons:
        p.use_smooth = True
    box_uvs(obj, tile)
    obj["seam_path"] = [c for co in snapped for c in co]  # for seam_puckers
    obj["seam_closed"] = closed
    return obj


def cylinder(name, radius, z0, z1, material, vertices=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=z1 - z0,
                                        location=(0, 0, (z0 + z1) / 2))
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(material)
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def glide(name, x, y, radius, height, material):
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=radius, depth=height, location=(x, y, height / 2))
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(material)
    return obj


# --- Surface detail (on applied meshes) ---------------------------------------------------


def vertex_arrays(mesh):
    n = len(mesh.vertices)
    co = np.empty(n * 3, dtype=np.float64)
    nor = np.empty(n * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", co)
    mesh.vertices.foreach_get("normal", nor)
    return co.reshape(n, 3), nor.reshape(n, 3)


def displace(mesh, offsets):
    """Moves each vertex along its normal by `offsets` (meters)."""
    co, nor = vertex_arrays(mesh)
    co += nor * offsets[:, None]
    mesh.vertices.foreach_set("co", co.ravel())
    mesh.update()


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def seam_puckers(mesh, welts, seed, amplitude=0.003, groove=0.0015, start=0.005, reach=0.007):
    """Upholstery pulled by the stitching along welted seams: a slight groove next to the
    welt and small irregular ripples across it, fading out within a few centimeters.
    Zero right at the seam (start), so the welts stay seated on the surface. Keep `reach`
    small (< 1 cm): longer ripples read as pleats across the panels."""
    from mathutils.kdtree import KDTree

    rng = np.random.default_rng(seed)
    points, along = [], []
    for welt_obj in welts:
        path = np.array(welt_obj["seam_path"]).reshape(-1, 3)
        s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
        points.append(path)
        along.append(s + rng.uniform(0, 10))  # different ripple phase per seam
    points, along = np.vstack(points), np.concatenate(along)
    tree = KDTree(len(points))
    for i, p in enumerate(points):
        tree.insert(p, i)
    tree.balance()

    co, _ = vertex_arrays(mesh)
    dist, s = np.full(len(co), np.inf), np.zeros(len(co))
    for i, p in enumerate(co):
        found = tree.find(p)
        if found[2] < 0.04:
            dist[i], s[i] = found[2], along[found[1]]
    # Irregular ripples: two incommensurate wavelengths (about 2-4 cm) along the seam.
    ripple = 0.6 * np.sin(2 * np.pi * s / 0.023) + 0.4 * np.sin(2 * np.pi * s / 0.037 + 1.3)
    falloff = smoothstep(start, start + 0.004, dist) * np.exp(-np.maximum(dist - start - 0.004, 0) / reach)
    displace(mesh, falloff * (amplitude * ripple - groove))
    print(f"REPORT seam puckers on {int((falloff > 0.05).sum())} vertices")


def remove_hidden_faces(obj):
    """Deletes faces buried inside other parts (seat sides inside the arms, the inner half of
    the welts, ...): they cost file size and AO texture space but can never be seen.

    A point is buried when a ray along its normal first hits a surface from behind (it is
    inside a closed part). A face is removed only when all its vertices and its center are
    buried, so the cut stays inside the covering part (the center matters for long faces
    whose ends both sit inside other parts, like a rail between two legs)."""
    from mathutils.bvhtree import BVHTree

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.normal_update()
    tree = BVHTree.FromBMesh(bm)
    def is_buried(co, n):
        loc, hit_normal, _, _ = tree.ray_cast(co + n * 1e-4, n, 1.0)
        return loc is not None and hit_normal.dot(n) > 0

    buried = {v.index: is_buried(v.co, v.normal) for v in bm.verts}
    hidden = [f for f in bm.faces
              if all(buried[v.index] for v in f.verts) and is_buried(f.calc_center_median(), f.normal)]
    total = len(bm.faces)
    bmesh.ops.delete(bm, geom=hidden, context="FACES")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    print(f"REPORT removed {len(hidden)} hidden faces of {total}")


# --- Baked ambient occlusion --------------------------------------------------------------


def join_applied(objects, name):
    """Replaces `objects` with one mesh that has their modifiers applied (so a texture can be
    baked onto the final, smoothed surface)."""
    deps = bpy.context.evaluated_depsgraph_get()
    parts = []
    for obj in objects:
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(deps))
        part = bpy.data.objects.new(obj.name + "Applied", mesh)
        part.matrix_world = obj.matrix_world
        bpy.context.scene.collection.objects.link(part)
        parts.append(part)
    for obj in objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = name
    # Consistent outward normals per closed part: AO rays (and AR shading) depend on them.
    bm = bmesh.new()
    bm.from_mesh(joined.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(joined.data)
    bm.free()
    return joined


def gltf_output_group():
    """The node group the glTF exporter reads extra outputs from (here: Occlusion)."""
    group = bpy.data.node_groups.get("glTF Material Output")
    if group is None:
        group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        group.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    return group


def bake_ao(obj, path, size=1024, samples=64, distance=0.3):
    """Bakes ambient occlusion of `obj` (contact shading in creases and under seams) into a
    second UV map and wires it as the glTF occlusion texture. Other meshes in the scene
    (e.g. legs) occlude too; no floor, since the AR view adds its own contact shadow."""
    mesh = obj.data
    # Keep names, not layer references: references go stale after edit mode.
    render_uv = mesh.uv_layers.active.name
    ao_uv = mesh.uv_layers.new(name="AOUV")
    mesh.uv_layers.active = ao_uv
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003)
    bpy.ops.object.mode_set(mode="OBJECT")
    mesh.uv_layers.active = mesh.uv_layers[render_uv]
    mesh.uv_layers[render_uv].active_render = True  # TEXCOORD_0 stays the tiling fabric UVs
    print(f"REPORT uv layers {[layer.name for layer in mesh.uv_layers]}")

    image = bpy.data.images.new("AO_" + obj.name, width=size, height=size, alpha=False)
    image.colorspace_settings.name = "Non-Color"
    bake_nodes = []
    for mat in mesh.materials:
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        # Pin the existing textures to the tiling UVs: with two UV maps the exporter would
        # otherwise bind them to whichever it considers the default.
        render_uv_node = nodes.new("ShaderNodeUVMap")
        render_uv_node.uv_map = render_uv
        for node in list(nodes):
            if node.type == "TEX_IMAGE" and not node.inputs["Vector"].is_linked:
                links.new(render_uv_node.outputs["UV"], node.inputs["Vector"])
        uv = nodes.new("ShaderNodeUVMap")
        uv.uv_map = "AOUV"
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image
        links.new(uv.outputs["UV"], tex.inputs["Vector"])
        nodes.active = tex
        bake_nodes.append((mat, tex))

    scene = bpy.context.scene
    previous_engine = scene.render.engine
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    if scene.world is None:
        scene.world = bpy.data.worlds.new("BakeWorld")
    scene.world.light_settings.distance = distance
    bpy.ops.object.bake(type="AO", margin=8, uv_layer="AOUV")
    scene.render.engine = previous_engine

    image.filepath_raw = path
    image.file_format = "JPEG"
    image.save()
    for mat, tex in bake_nodes:
        out = mat.node_tree.nodes.new("ShaderNodeGroup")
        out.node_tree = gltf_output_group()
        mat.node_tree.links.new(tex.outputs["Color"], out.inputs["Occlusion"])
    ao = np.array(image.pixels[:]).reshape(size, size, 4)[..., 0]
    print(f"REPORT ao mean={ao.mean():.2f} min={ao.min():.2f}")
    return image


# --- Checks, export, previews -------------------------------------------------------------


def evaluated_bounds(objects=None):
    deps = bpy.context.evaluated_depsgraph_get()
    mins, maxs = np.full(3, np.inf), np.full(3, -np.inf)
    tris = 0
    for obj in objects or bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        ev = obj.evaluated_get(deps)
        mesh = ev.to_mesh()
        mesh.calc_loop_triangles()
        tris += len(mesh.loop_triangles)
        mw = np.array(ev.matrix_world)
        co = np.array([v.co for v in mesh.vertices])
        co = (mw[:3, :3] @ co.T).T + mw[:3, 3]
        mins, maxs = np.minimum(mins, co.min(0)), np.maximum(maxs, co.max(0))
        ev.to_mesh_clear()
    return mins, maxs, tris


def check_and_report(mins, maxs, tris, seat_top):
    size = maxs - mins
    if abs(mins[0] + maxs[0]) > SIZE_TOLERANCE_M or abs(mins[2]) > 1e-4:
        raise SystemExit(f"Origin is not at the bottom center: min={mins} max={maxs}")
    print(f"REPORT bounds_min={mins.round(4).tolist()} bounds_max={maxs.round(4).tolist()}")
    print(f"REPORT size_m width={size[0]:.3f} depth={size[1]:.3f} height={size[2]:.3f} "
          f"seat={seat_top:.3f} triangles={tris}")


def setup_preview(exposure=-1.6):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 900, 1100
    scene.render.film_transparent = False
    # Neutral display transform: AgX (the default) washes out light fabrics in thumbnails.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = exposure
    world = bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.92, 0.91, 0.89, 1)
    bg.inputs["Strength"].default_value = 0.6

    # Floor that only catches shadows visually (simple light-gray plane).
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
    floor = bpy.context.active_object
    floor.name = "PreviewFloor"
    mat, bsdf = principled("Floor")
    bsdf.inputs["Base Color"].default_value = (0.75, 0.74, 0.72, 1)
    bsdf.inputs["Roughness"].default_value = 0.5
    floor.data.materials.append(mat)

    bpy.ops.object.light_add(type="AREA", location=(1.2, -1.6, 2.4))
    key = bpy.context.active_object
    key.data.energy = 300
    key.data.size = 2.0
    key.rotation_euler = (math.radians(45), 0, math.radians(35))
    bpy.ops.object.light_add(type="AREA", location=(-1.8, -0.5, 1.6))
    fill = bpy.context.active_object
    fill.data.energy = 150
    fill.data.size = 2.0
    fill.rotation_euler = (math.radians(60), 0, math.radians(-75))

    bpy.ops.object.camera_add()
    cam = bpy.context.active_object
    cam.data.lens = 50
    scene.camera = cam
    return cam


def render_from(cam, location, target, path):
    cam.location = location
    direction = np.array(target) - np.array(location)
    # Camera looks along +Y after the 90° X rotation; rotating by yaw around Z gives (-sin, cos).
    yaw = math.atan2(-direction[0], direction[1])
    pitch = math.atan2(direction[2], math.hypot(direction[0], direction[1]))
    cam.rotation_euler = (math.radians(90) + pitch, 0, yaw)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def render_previews(directory, build_dir, distance=2.0, target_z=0.40):
    """Front, three-quarter, side and close-up previews in _build/, plus the square catalog thumbnail."""
    cam = setup_preview()
    d = distance
    render_from(cam, (0.0, -d, 0.85), (0, 0, target_z), os.path.join(build_dir, "preview_front.png"))
    render_from(cam, (0.75 * d, -0.85 * d, 1.15), (0, 0, target_z), os.path.join(build_dir, "preview_three_quarter.png"))
    render_from(cam, (1.1 * d, 0.0, 0.75), (0, 0, target_z), os.path.join(build_dir, "preview_side.png"))
    # Close-up of the front corner (arm front, seat edge) to judge the materials.
    render_from(cam, (0.45, -0.95, 0.85), (0.18, -0.25, 0.48), os.path.join(build_dir, "preview_detail.png"))

    scene = bpy.context.scene
    scene.render.resolution_x = scene.render.resolution_y = 800
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 88
    render_from(cam, (0.72 * d, -0.88 * d, 1.05), (0, 0, target_z), os.path.join(directory, "thumbnail.jpg"))


def export(directory):
    """Writes model.glb and model.usdz (Y-up) from every mesh in the scene."""
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            o.select_set(True)
    glb = os.path.join(directory, "model.glb")
    bpy.ops.export_scene.gltf(
        filepath=glb,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_image_format="AUTO",
        export_materials="EXPORT",
    )
    usdz = os.path.join(directory, "model.usdz")
    bpy.ops.wm.usd_export(
        filepath=usdz,
        selected_objects_only=True,
        export_materials=True,
        export_uvmaps=True,
        generate_preview_surface=True,
        convert_orientation=True,
        export_global_up_selection="Y",
        export_global_forward_selection="NEGATIVE_Z",
    )
    for path in (glb, usdz):
        print(f"REPORT file {os.path.basename(path)} {os.path.getsize(path) / 1e6:.2f} MB")
    return glb, usdz
