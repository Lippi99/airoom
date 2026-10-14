# Sample 3D model credits

Development seed only. Products with a real 3D model:

| Product id | Model | Source / credit | License |
|---|---|---|---|
| `prod-sofa-oslo` | GlamVelvetSofa | [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) — © 2021 Wayfair, LLC, artist Eric Chadwick | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode) |
| `prod-chair-mira` | ChairDamaskPurplegold | Khronos glTF Sample Assets — © 2021 Wayfair, artist Eric Chadwick | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode) |
| `prod-chair-sol` | swivel-tub-armchair | Built in this repo with Blender: `tools/models/swivel_tub_armchair.py`, served by the API from `apps/api/static/` | Project asset |
| `prod-chair-cora` | tub-club-armchair | Built in this repo with Blender: `tools/models/tub_club_armchair.py`, served by the API from `apps/api/static/` | Project asset |
| `prod-chair-nara` | strap-lounge-armchair | Built in this repo with Blender: `tools/models/strap_lounge_armchair.py`, served by the API from `apps/api/static/` | Project asset |
| `prod-art-knights` | framed-painting-knights | Frame and canvas built with Blender (`tools/models/framed_painting.py`); the artwork is a perspective-corrected phone photo of the painting (`tools/models/sources/`). Development placeholder: production needs the retailer's licensed high-resolution image | Artwork © its artist |

The Khronos models load directly from GitHub. Their dimensions in `products.json` were
measured from the models' bounding boxes (`npx @gltf-transform/cli inspect`); they have no
USDZ versions (iOS AR is step 4).

All other `glbUrl`/`usdzUrl` values are placeholders on `cdn.example.com` and fail to load
(useful to test the "model download failed" state).
