# Step 3c — Scenes and on-scene controls

**Status:** implemented on Android and **confirmed on the test phone** (Galaxy Z Flip6,
2026-10-14): several products per scene, save with one cloud anchor per item, and reopening at
the same spot in the room (also after a full app restart). Unit tests pass (API 69, mobile 61,
Kotlin 35). iOS: contract stub (step 4).

**Goal:** arrange several different products in one AR session (a "scene"), move them
precisely, delete them easily, and save the arrangement under a name to reopen later, back at
the same spot in the room.

## What the user can do

1. **Scenes tab** → **New scene** (or open a saved one). "View in your room" on a product
   still works: it opens a new scene with that product ready to place.
2. **＋ Add furniture** opens the catalog as a sheet over the camera (category chips). Picking
   a product enters *placing mode*: center dot + `Place <name>` (or Cancel). Repeat for as
   many products as wanted: sofas, chairs, rugs, wall art, all in the same scene.
3. **Tap** an item: it is selected (highlight) and **four arrows** appear around it, one at
   the middle of each edge:
   - floor items: on the floor, left / right / "top" (away from its front) / "bottom"
     (toward its front), in the item's own directions;
   - wall art: on the wall, left / right / up / down.

   Tap an arrow = move **5 cm**; hold it = keep moving (~45 cm/s after 0.4 s). Same rules as
   dragging: collisions, stay on the detected floor, wall art stays above the floor; a
   blocked step flashes red and shows the reason. Drag and two-finger twist still work.
   A bar at the bottom shows the selected product with **Buy** and **Remove**.
4. **Double tap** an item: a red **trash** button appears over it (above floor items, turned
   to the camera; over the middle of wall art). Tap it to delete the item; tap anywhere else
   to dismiss it.
5. **Save** (top right) asks for a name (max 60 characters). The dialog closes and the hint
   asks to walk slowly around the furniture, pointing at each piece, while each item's spot in
   the room is saved ("Saved 1 of 3 spots. Now point at …"). Saving again updates the same
   scene (the name can be changed). Leaving with unsaved changes asks first.
6. **Reopen** a saved scene and look around where it was saved: each item comes back at its
   own spot as soon as the phone recognizes it ("Found 1 of 3…"); the rest follow within a few
   seconds. **Place it where I point instead** skips that and rebuilds the scene around the
   point the screen center aims at (automatic once the floor is detected), as do scenes whose
   spots were not saved. **Re-place scene** takes the scene out and places the saved version
   again where the user points (asks first if there are unsaved changes).
7. **Shopping list:** the pill at the top shows the scene's name, item count and total price.
   Tapping it lists each product (copies on one line, "2 × $899.00") with a **Buy** button
   each (through `/go/:productId`, so clicks are tracked) and the total. A saved scene still
   coming back counts whole. The Scenes tab shows each scene's total too.
8. **Share** (top bar, once something is placed) takes a photo of the AR view without the
   selection and arrows (`captureSnapshot`) and opens the system share sheet (`expo-sharing`).

Scenes live **in the API's memory** (`InMemorySceneRepository`): they survive closing the app
but are lost when the API restarts (also when its code changes in watch mode), until a database
is added (CLAUDE.md 5.5). There are no users yet, so every device sees every scene.

## Same spot in the room: ARCore Cloud Anchors

Each AR session has its own origin, so putting things back where they were means recognizing
the room: **ARCore Cloud Anchors** (Google Cloud setup below). History, all on-device findings
from 2026-10-14:

1. Rebuilding around the aimed point kept the layout but not the room position ("they should
   have their position saved") → cloud anchors.
2. One anchor at the reference item: other items drifted ("not 100% in their original";
   paintings 1.8 m away showed it most), and items sometimes floated → this design:

- **One cloud anchor per item**, hosted at the item's own pose (position + yaw, TTL 365
  days) with `hostItemAnchor(instanceId)`, all at once. No lever arm: a 1° angle error at the
  reference used to move a painting 1.8 m away by ~3 cm. Each request waits until its item has
  been on screen (within 5 m) while ARCore's `estimateFeatureMapQualityForHosting` is not
  `INSUFFICIENT`, then uploads; after 15 s it uploads anyway and lets the server decide (the
  local estimate sometimes stayed `INSUFFICIENT` in a lit, furnished room). A one-shot check at
  the moment Save was tapped, with the dialog covering the camera, always failed. The wait was
  40 s at first: on the test phone the estimate never left `INSUFFICIENT`, so every save waited
  the full 40 s, and every upload after it succeeded.
- **Re-saving** an item that is still at its anchor (restored or hosted, not moved since,
  `ARPlacedItem.cloudAnchorId`) keeps that anchor if it lives at least 30 more days: no new
  upload, no new error.
- **Reopening** resolves all anchors at once (`resolveCloudAnchor` per anchor). ARCore keeps
  refining an anchor for a moment after recognizing it, and the first pose is the roughest:
  an anchor is reported once it has been tracked for 1.5 s (4 s at most). Its item is placed
  with `placeItem({ cloudAnchorId })` and **keeps following the anchor** (eased every frame,
  2 mm / 0.2° dead-bands; floor items in X/Z + yaw, wall items only along their wall) until
  the user moves it.
- Once the first anchor is found, the others get **4 s**; then the items still missing (or
  without an anchor) are placed around the found ones: one found item gives the reference
  directly, several give a least-squares rigid fit of their positions (`fitReference`;
  averaged yaws when they are bunched within ~25 cm).
- No anchor found (cancelled, expired, not set up): the scene is rebuilt around the aimed
  point, with a message saying why.

### Google Cloud setup (once per project / signing key)

Cloud Anchors kept longer than a day need **keyless authorization**: the app proves its
identity with its package name + signing certificate through Google Play services
(`play-services-auth-base`, added to the module). Until this is done, saving reports
"remembering exact spots is not set up yet" and scenes come back where you point.

1. [console.cloud.google.com](https://console.cloud.google.com): create (or pick) a project.
   (Done for development: project `airoom-ar-10132216`, ARCore API enabled.)
2. **APIs & Services → Library**: enable **ARCore API**.
3. **APIs & Services → OAuth consent screen**: configure it (External, app name, support
   e-mail). Required before creating the client below.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID → Android**:
   - package name `com.airoom.app`
   - SHA-1 of the debug key: `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`
     (`apps/mobile/android/app/debug.keystore`, Expo's template key, kept by `prebuild`)
5. Nothing to change in the app. Release/EAS builds are signed with another key: add an
   Android OAuth client with that key's SHA-1 too (`eas credentials` shows it).

Free quota covers development; see Google's ARCore API pricing/quotas before production.

## Floor items stay on the floor

The second complaint of the precision round: furniture "flying a little".

- **Floor settling** (CLAUDE.md 4.3): ~5 Hz, for every floor item not being dragged or nudged,
  the floor under it is measured, from the detected floor plane under its center or else from
  a 3x3 grid of depth / feature-point hits under its footprint (`ArMath.floorFromSamples`:
  hits more than 12 cm off their spot or 15 cm off in height are dropped, median of at least
  4), and the item is eased onto it (gain 0.3, 3 mm dead-band, offsets over 15 cm ignored).
  Once settled over a floor plane, an item on a free anchor is anchored on it. Restored items
  start at the saved height and ARCore's floor estimate keeps improving after placement; both
  left items floating or sunk by a few cm.
- **Baked contact shadows** (CLAUDE.md 4.5): the generic soft rectangle under each item could
  not show legs, so legged chairs looked like they hovered even when touching the floor. The
  floor models now carry their own shadow, baked in Blender from the ambient occlusion they
  cast on the floor: dark spots under each leg, soft shading under the seat
  (`modelkit.contact_shadow`, ~0.1 MB in the GLB). The app hides its generic shadow for them.

## How a scene is stored

- `items[0]` is the reference: the first **floor** item placed (the floor is the same
  wherever the user aims; a wall is not), or the first item if there are only wall items.
  Its pose is the identity.
- Every other item: `{ x, y, z, yaw }` in the reference's frame (meters along its right / up
  / front, yaw relative to its yaw). See `ScenePose` in `packages/shared/src/scenes.ts` and
  the math in `apps/mobile/src/ar/layout.ts`.
- Each item may carry its own `anchor: { cloudAnchorId, expiresAt }`.

```json
{
  "id": "6f1c…",
  "name": "Living room",
  "items": [
    { "productId": "prod-chair-cora", "pose": { "x": 0, "y": 0, "z": 0, "yaw": 0 },
      "anchor": { "cloudAnchorId": "ua-0fdf…", "expiresAt": "2027-10-14T21:11:36.772Z" } },
    { "productId": "prod-chair-nara", "pose": { "x": 0.95, "y": 0, "z": 0.1, "yaw": -0.35 },
      "anchor": { "cloudAnchorId": "ua-91b2…", "expiresAt": "2027-10-14T21:11:41.020Z" } },
    { "productId": "prod-art-knights", "pose": { "x": 0.4, "y": 1.45, "z": -0.9, "yaw": 0 } }
  ],
  "createdAt": "2026-10-14T21:11:43.000Z",
  "updatedAt": "2026-10-14T21:11:43.000Z"
}
```

## What was built

| Path | Change |
|---|---|
| `packages/shared/src/scenes.ts`, `routes.ts` | `SceneDto`, `SceneItemDto` (with `anchor?`), `ScenePose`, `SceneAnchor`, `SaveSceneRequest`, limits; `ApiRoutes.scenes/scene(id)` |
| `apps/api/src/domain/*` | `Scene` entity (items with anchors), `SceneRepository` interface |
| `apps/api/src/repositories/in-memory/in-memory-scene-repository.ts` | In-memory implementation (copies in/out) |
| `apps/api/src/services/scene-service.ts` | List/get/create/update/delete; rejects products not in the catalog (or inactive) |
| `apps/api/src/http/routes/scene-routes.ts`, `schemas.ts` | Endpoints + Zod validation; wired in `container.ts` / `app.ts` |
| `modules/furniture-ar/src/FurnitureAR.types.ts` | `ARItem.pose?` / `cloudAnchorId?`, `ARPose`, `ARPlacedItem` (+ `cloudAnchorId?`), `getPlacedItems`, `hostItemAnchor`, `resolveCloudAnchor`, `stopResolvingCloudAnchors`, `onItemRemoved`, `CLOUD_ANCHOR_*` codes |
| `ios/FurnitureARModule.swift`, `FurnitureARView.swift` | Same contract additions (stubs) |
| `android/.../FurnitureARModule.kt`, `ARItemRecord.kt`, `PlacedItem.kt` | New functions, records, per-item cloud anchor state |
| `android/.../FurnitureARView.kt` | Place at a pose / on a cloud anchor (never blocked), arrows, double tap → trash, per-item hosting with mapping-quality wait, concurrent resolving with settling, following, floor settling, baked shadow detection |
| `android/src/main/materials/furniture_icon.mat` (+ `.filamat`) | Procedural arrow and trash icons, drawn on top of everything |
| `android/.../ArMath.kt` | `toWorld`, handles, `snapToWall`, `followStep`, `floorFromSamples` (+ tests) |
| `android/build.gradle` | `play-services-auth-base` (Cloud Anchors keyless auth) |
| `apps/mobile/src/ar/layout.ts` | World ↔ scene poses, reference choice, `fitReference`, anchors per item (+ tests) |
| `apps/mobile/src/api/client.ts` | `getScenes`, `getScene`, `createScene`, `updateScene`, `deleteScene` (+ tests) |
| `apps/mobile/app/(tabs)/scenes.tsx` | Scenes tab: list (thumbnails, count, date), open, delete, New scene |
| `apps/mobile/app/ar.tsx` | Scene editor: Add sheet, placing mode, selected-item bar, Save (per-item anchors), restore (anchors, then aim), shopping list pill, Share |
| `apps/mobile/src/components/ProductPickerSheet.tsx`, `SaveSceneDialog.tsx` | The sheet and the name dialog |
| `apps/mobile/src/utils/shoppingList.ts`, `src/components/ShoppingListSheet.tsx` | Shopping list: a line per product, totals per currency (+ tests); the sheet |
| `apps/mobile/src/utils/buy.ts` | `openBuyPage`: every Buy button opens `/go/:productId` |
| `apps/mobile/src/ar/guidance.ts` | Hints for placing vs arranging; cloud anchor messages |
| `tools/models/modelkit.py` + the 3 floor model scripts | `contact_shadow()`: baked AO shadow quad in the GLB (not the USDZ); `preview_grounding.png` |

## API

| Method | Path | Body / result |
|---|---|---|
| GET | `/scenes` | `SceneDto[]`, most recently updated first |
| GET | `/scenes/:id` | `SceneDto` or 404 |
| POST | `/scenes` | `SaveSceneRequest` → 201 `SceneDto` |
| PUT | `/scenes/:id` | `SaveSceneRequest` → 200 `SceneDto` (name and items, anchors included, replaced) or 404 |
| DELETE | `/scenes/:id` | 204 or 404 |

Validation (400 `VALIDATION_ERROR`): name 1-60 characters after trimming, 1-30 items, finite
pose numbers within ±100 m (yaw ±10 rad), anchors with an id (≤ 200 chars) and an ISO
date. Products missing from the catalog or inactive: 400 `UNKNOWN_PRODUCT`.

## Native details (Android)

- **Controls** are `PlaneNode` quads made children of the selected item's pivot, so they
  follow drags, twists and wall refinement. One set of 4 flat arrows (floor), 4 upright
  arrows (wall), one trash quad, shared by all items and moved to the selected one.
- The icons are drawn by a Filament shader from the quad's **model-space position** (not its
  UVs, whose layout depends on SceneView's plane geometry): sharp at any distance, no texture.
  `depthCulling: false` keeps them visible through the furniture (an arrow behind a sofa
  can still be pressed).
- **Touch:** on touch-down, an arrow within 32 dp of the finger wins over the item behind it.
  Double tap = two taps on the same item within 350 ms (the first tap selects immediately,
  no delay). The trash button is hit-tested the same way.
- **Nudge:** `ArMath.toWorld(handleDirection) × 5 cm`, validated like a drag step; the item is
  re-anchored (on the floor plane under it) when the finger lifts.
- **Restoring** (`ARItem.pose` or `cloudAnchorId`): no hit test, **never blocked** by
  collisions (CLAUDE.md 4.4 rule 13; a painting of a reopened scene went missing because the
  wall estimate was a few cm off its saved spot), not selected. Floor items stand at the
  height of the floor plane under them (else the anchor's height), then floor settling takes
  over. Wall items are snapped onto the closest detected wall facing the same way (within 15°
  and 25 cm, `ArMath.snapToWall`), then the wall refinement takes over. Skipped items are
  named in the message and the reason is logged (`Restoring <id> failed`).
- **User moves** (drag, arrows, twist) release the item's cloud anchor: it stops following
  it, and `getPlacedItems` no longer reports it.
- **Baked contact shadow:** if the model has a node named `ContactShadow`, it is kept from
  casting/receiving shadows and the generic procedural shadow is hidden.
- `removeItem` (called by JS) does not emit `onItemRemoved`; the trash button does.

## Known limits

- **Exact spots need cloud anchors** (Google Cloud setup, internet, the room looking about
  the same as when saved: lighting, furniture moved). Typical accuracy is a few cm and under
  1°, not millimeters. Without anchors the arrangement is rebuilt around the aimed point; wall
  art may then float until moved.
- Saving takes a walk around the furniture (each item must be seen well); items not seen
  within 15 s are uploaded anyway and may fail as `CLOUD_ANCHOR_LOW_QUALITY`. Those items come
  back around the others.
- Moves are not reported to JS, so "unsaved changes" is approximate: any placement, removal
  or selection since the last save counts as a change.
- Scenes are lost when the API restarts, and are shared by all devices (no users yet).
- The arrows' 5 cm step is fixed; holding is the way to cover distance quickly.
- iOS: stubs only (step 4 must implement the same contract: `pose`, `cloudAnchorId` with
  following, per-item hosting, concurrent resolving, floor settling, the arrows and the trash).

## Verification

| Check | Result |
|---|---|
| API: repository, service, HTTP (CRUD, validation, unknown products, per-item anchors) | `npm test -w apps/api`: 69 passed |
| Mobile: layout math (incl. `fitReference`), API client, guidance | `npm test -w apps/mobile`: 52 passed; `tsc` clean |
| Kotlin: handles, `toWorld`, `snapToWall`, `followStep`, `floorFromSamples` | `./gradlew :furniture-ar:testDebugUnitTest`: ArMath 30, CollisionMath 5 passed |
| Models: contact shadow exported as unlit/BLEND `ContactShadow` node; GLB ≤ 5 MB | Cora 4.16 MB, Nara 4.35 MB, Sol 1.96 MB; USDZ unchanged |
| Build + install (`gradlew :app:installDebug`, over Wi-Fi) | OK on the Galaxy Z Flip6 |
| On device: Add sheet, several products, save, cloud anchor upload | Confirmed (scene "Escritório", 3 items; hosting `SUCCESS`) |
| On device: per-item anchors | Confirmed: scene "Sala", 3 of 3 anchors hosted (`SUCCESS`; the local estimate stayed `INSUFFICIENT`, uploaded after the 40 s wait) |
| On device: reopen at the same spot | Confirmed by the user ("it worked"): 7 reopenings, 2 of them after a full app restart, all 3 anchors found and settled each time (~1.5 s after recognition) |
| On device: floor settling, baked contact shadows | Running in the same tests; not commented on separately |
| Mobile: shopping list, favorites kept on device | `npm test -w apps/mobile`: 61 passed; `tsc` clean |
| On device: 15 s save wait | Confirmed: 3 of 3 anchors hosted `SUCCESS` (estimate still `INSUFFICIENT`, uploaded at 15 s); whole save ~28 s (was ~45–50 s); reopened right after, all 3 found and settled; again after a full app restart |
| On device: shopping list, Share, favorites after an app restart | Pending |
