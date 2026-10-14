# 3D model scripts (Blender)

Procedural furniture models built with Blender's Python API, so they can be regenerated
and tweaked from code. Output follows CLAUDE.md §4.5: meters, real size, Y-up, origin at
the bottom center, PBR materials, ≤ 5 MB, both GLB and USDZ.

Requires Blender 5.2+ (installed at `C:\Program Files\Blender Foundation\Blender 5.2`).

```bash
# from the repo root
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
  --python tools/models/swivel_tub_armchair.py -- apps/api/static/models/swivel-tub-armchair
```

Each script writes `model.glb`, `model.usdz` and `thumbnail.jpg` to the output folder, and
generated textures plus preview renders to `<output>/_build/` (git-ignored, never served).
It prints a `REPORT` with the measured size, triangle count and file sizes, and corrects
its own construction sizes until the finished model matches the target dimensions within
2 mm (subdivision smoothing shrinks surfaces).

| Script | Product | Size (W × D × H) |
|---|---|---|
| `swivel_tub_armchair.py` | `prod-chair-sol` (Sol Swivel Armchair) | 60 × 58 × 78 cm, seat 47 cm |
| `tub_club_armchair.py` | `prod-chair-cora` (Cora Tub Armchair) | 76 × 74 × 78 cm, seat 45 cm |
| `strap_lounge_armchair.py` | `prod-chair-nara` (Nara Lounge Armchair) | 72 × 78 × 80 cm, seat 45 cm |
| `framed_painting.py` | `prod-art-knights` (Harlequin Knights Framed Canvas, wall art) | 120 × 90 × 4.5 cm (estimated) |

Shared helpers (texture synthesis, rounded upholstery shapes, welts, size checks, AO bake,
previews, export) live in `modelkit.py`, which the scripts import from their own folder.

During development the API serves `apps/api/static/` at `/static/*`; seed products point to
it with relative URLs (`/static/models/...`). In production, models go on a CDN.

## Guide for new furniture

`tub_club_armchair.py` is the reference script for upholstered pieces and
`strap_lounge_armchair.py` for wooden frames with loose cushions: copy their structure (constants → textures →
materials → parts → build/measure/correct loop → AO bake → export → previews).

### Workflow

1. **Read the product photo first.** List shape, seams, legs and material before coding;
   measure the average fabric color from lit and shaded areas and note both in a comment.
2. **Build into a scratch folder** (not `apps/api/static/`) and iterate on the previews in
   `_build/` until it matches the photo; only then build into the static folder.
3. **Always check `preview_detail.png`** (the close-up). Texture problems that are
   invisible in the full view (fur-like fibers, swirls, stretching) show up there.
4. **Register the product:** seed entry in `products.json` with `sizeBytes` = the GLB size,
   a row in the table above, and a row in `apps/api/src/data/seed/MODEL_CREDITS.md`. Run
   `npm test -w apps/api`.

### Geometry

- **Upholstery** = smooth shapes with a Subdivision modifier: swept cross-section rings
  for shells/arms/backs (`build_shell`), `mk.pillow` (superellipsoid) for seats, cushions
  and bottoms. Overlapping parts are fine; the intersection reads as a tuck.
- **Size correction:** subdivision shrinks surfaces, so the build loop measures the
  evaluated bounds and adjusts the raw sizes (`Params`) until within 2 mm. Add every
  dimension that matters (width, depth, height, seat) to the error list.
- **Seams:** crease the seam edge loop (`mk.crease_edges`, ~0.6) and add piping with
  `mk.welt` (cord radius ~3.5 mm, snapped onto the smoothed surface). Welts are the detail
  that makes upholstery read as real.
- **Rounded corners:** avoid sharp corners in cross-sections (they subdivide into points);
  add an intermediate point instead.
- **Legs:** build them so the foot is cut level at z = 0 (origin at the bottom center is
  checked by `mk.check_and_report`).
- **Surface detail** (`add_detail` in `tub_club_armchair.py`), applied after the size loop on
  the joined, smoothed mesh and before the AO bake (so AO sees it):
  - seat sag: a soft ~15 mm dip where people sit;
  - `mk.seam_puckers`: ~3 mm irregular ripples plus a slight groove next to every welt,
    fading out within ~1 cm;
  - enough mesh density for them (shell rings every ~1.5-3 cm before subdivision).
- **Hidden faces:** `mk.remove_hidden_faces` deletes faces buried inside other parts (seat
  sides inside the arms, the inner half of the welts). It removed ~45% of the upholstery
  with no visible change; it is what keeps the detailed model under 5 MB. A face goes only
  when its vertices *and* its center are buried (a rail between two legs has all its
  vertices inside the legs but is visible).
- **Wooden members:** `board` in `strap_lounge_armchair.py`: a beveled box whose UVs run the
  grain along its length, with a random texture offset per board; `level_ends` for legs.
- **Webbing straps:** `strap`: a closed thin band looped over a rail; mark its long edges
  sharp (smooth shading across the thin edges makes it look like a round tube). Straight
  runs need no intermediate points.

### Textures and materials (the approved recipe)

All textures are generated with numpy, **tileable**, and scaled so their average equals the
measured product color (`mk.match_mean`). Save color and normal maps as **JPEG** (noise
compresses badly as PNG).

**Microsuede / velvet-like fabric** (`suede_images` in `tub_club_armchair.py`, approved):

- **2048 px** covering **30 cm** (a large tile so nothing visibly repeats). The pixel
  parameters below were tuned at 1024 px and scale with the size (`k = size / 1024`;
  blur passes with `k²`), so the look is the same in centimeters at any resolution.
- Brightness variation, roughly: soft multi-scale `patches` ±3.5% (the main character),
  fine `dye` 1%, faint directional `nap` streaks 1.2% (`mk.streaks` along a smooth flow
  field), very fine `fibers` 1.2% (2 px streaks).
- Darker areas slightly more saturated: multiply R, G, B by `shade`, `shade**1.15`,
  `shade**1.3`.
- Weak normal map (height from fibers + nap, strength 0.05; material normal strength
  0.35), roughness 0.85, sheen weight 0.3 tinted toward the fabric color.

**Woven fabric** (`fabric_images` in `swivel_tub_armchair.py`): plain weave with per-crossing
light/dark yarn mix (melange), 6 cm tile.

**Linen** (`linen_images` in `strap_lounge_armchair.py`): 2048 px over 10 cm (128 threads,
~0.8 mm), slubs (each thread thickens and lightens irregularly along its length), weft a
touch lighter than warp; also used for the webbing straps.

**Wood** (`wood_images` in `strap_lounge_armchair.py`): 2048 × 512 px over 60 × 15 cm,
grain along the long side. Straight grain: growth lines wander by ≤ ~2 mm, line contrast
≤ ~6%, sparse pores streaked along the grain; satin roughness 0.45.

**What did not work (don't repeat):**

- Small tiles (≤ 8 cm) with blotchy noise → visible repetition, reads as camouflage.
- Strong directional nap (> ~2%) → graphic flame/fern swirls.
- Long or strong fiber streaks (≥ 4 px) → looks like animal fur.
- Per-thread (instead of per-crossing) color variation in weaves → plaid at a distance.
- Arc-length UVs on tapered parts → stretched streaks; use `mk.box_uvs` (world-scale box
  projection).
- Overall "padding lumps" from a few summed sine waves → regular corrugation stripes.
- Seam puckers reaching several cm from the seam → read as pleats across the panels.
- Averaging big textures in float32 → the color drifts a few levels (use float64).
- Strongly wandering or high-contrast wood grain → reads as zebrawood/plywood swirl.

### Baked ambient occlusion

After the size loop, join all fabric parts (`mk.join_applied`) and run `mk.bake_ao`: it
creates a second UV map, bakes AO with Cycles and wires it as the glTF occlusion texture
(contact shading under welts and in creases; AR renderers use it). Notes:

- Fabric textures stay on `TEXCOORD_0`, AO on `TEXCOORD_1`; `bake_ao` pins them with UV
  Map nodes (otherwise the exporter binds everything to the AO UVs).
- Don't add a roughness map next to AO: the exporter packs both into one large PNG with
  the wrong UVs.
- Large black islands in the AO image are normal: hidden faces (seat sides inside the arms).
  Verify by rendering the exported GLB with the AO as color, not by looking at the image.
- USDZ export does not carry the AO map (Blender's USD exporter limitation).

### Wall art

`framed_painting.py` builds a framed canvas. Differences from furniture:

- **Origin at the center of the back face** (the point on the wall), front toward glTF +Z,
  category `wall-art` (CLAUDE.md 4.2-4.5: placed on a detected wall, dragged along it).
- **The artwork is a photo, not a procedural texture.** `rectify` perspective-corrects the
  canvas from a photo (corners measured on a zoomed grid, pulled ~2 px inside the frame);
  `remove_tape` paints out tape/stickers by interpolating each row between clean pixels.
  The artwork texture stays at the source's real resolution (no 2K upscale). Use a
  straight-on, high-resolution image from the retailer (who holds the reproduction rights)
  for production; `sources/knights_painting_photo.png` is a low-res phone photo.
- The canvas sides reuse the edge pixels (gallery wrap, `EXTEND`), and a tiled weave normal
  map on a second UV map gives the paint surface its texture.

### Budget

Target ≤ 5 MB per file, **uncompressed** (CLAUDE.md §4.5: no Draco/Meshopt/KTX2, textures
at 2K, never 4K; the AO map stays at 1K, it is soft shading and 2K only adds ~0.7 MB).
Cora (2K fabric, seat sag, seam puckers, ~124k triangles before hidden-face removal) lands
at 4.0 MB GLB / 4.9 MB USDZ; Nara (2K linen + wood, ~70k triangles) at 4.2 / 4.8 MB.
Pillow `cuts` drive most of a cushion's size (12 is enough for welts and puckers). The USDZ is the tighter one (it
stores per-corner normals and UVs). If a model doesn't fit, cut hidden or unneeded geometry
(fewer shell rings, lower pillow `cuts`) or shrink the fabric's normal map, the largest
texture.

**Limits:** these are simplified, stylized models (shape, proportions and material type),
not photo-real scans. For realistic product models prefer retailer-provided files,
photogrammetry or a 3D artist.
