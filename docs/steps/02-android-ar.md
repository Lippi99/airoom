# Step 2 — Android AR

**Status:** implemented, builds and runs; **AR itself not yet tested on a physical ARCore phone**
(2026-10-12)
**Roadmap item:** `furniture-ar` module with SceneView, floor detection, placing one item,
move and rotate.

---

## 1. What was built

### Native module `apps/mobile/modules/furniture-ar/`

| Path | Purpose |
|---|---|
| `index.ts` | Public API (the contract): `FurnitureARView`, `FurnitureAR.isSupported()`, types |
| `src/FurnitureAR.types.ts` | Props, events, `ARItem`, `FurnitureARViewRef`, `ARErrorCode` |
| `src/FurnitureARView.tsx` / `src/FurnitureARModule.ts` | JS wrappers over the native view/module |
| `android/.../FurnitureARModule.kt` | Module definition: `isSupported`, view props/events/methods |
| `android/.../FurnitureARView.kt` | AR view: session, planes, placement, gestures, snapshot |
| `android/.../ArMath.kt` | Pure geometry: screen rays, ray-vs-box picking, twist angles |
| `android/.../ModelCache.kt` | On-demand model download with an LRU disk cache (300 MB) |
| `android/.../PlacedItem.kt`, `ARItemRecord.kt` | Per-item scene nodes; `ARItem` record |
| `android/src/test/.../ArMathTest.kt` | 12 JVM unit tests |
| `ios/*.swift` | Contract-identical stub until step 4 (see below) |

### What the Android view does

- **Session:** ARCore with horizontal + vertical plane finding, `ENVIRONMENTAL_HDR` light
  estimation (environment lighting and reflections), and the Depth API where supported
  (occlusion of people and objects in front of furniture).
- **Floor detection:** "floor" = upward-facing planes within 15 cm of the lowest one, so a
  table top is not treated as floor. Emits `onPlaneDetected` for `floor` and `wall` counts.
- **Placement:** `placeItem` hit-tests the screen center against the floor, creates a
  world-aligned anchor, shows the item's footprint immediately, downloads the GLB
  (cached on disk), then attaches the model at **1:1 scale**, facing the camera.
- **Gestures (native):** tap = select / deselect (`onItemSelected`, `onItemTapped`);
  one-finger drag = move on the floor (X/Z only, keeps the grab point under the finger);
  two-finger twist = rotate around Y only. No scaling. On release the item is re-anchored.
- **Selection highlight:** a translucent footprint (the real `width × depth`, i.e. the
  future collision footprint) under the selected item.
- **Blocked moves:** dragging off the floor keeps the last valid pose, flashes the
  footprint red and emits `onPlacementBlocked` with `reason: 'noFloor'` once per streak.
  `validateMove()` is the hook where step 3 plugs in wall/item collisions.
- **Shadows:** models cast shadows; detected planes receive them (also when the plane grid
  is hidden).
- **Snapshot:** `captureSnapshot` hides footprints, copies the AR surface (`PixelCopy`) and
  returns a `file://` JPEG.
- **Tracking:** `onTrackingStateChanged` (`normal` / `limited` / `notAvailable`).

### App (`apps/mobile`)

| Path | Purpose |
|---|---|
| `app/ar.tsx` | AR screen: support check, camera permission, guidance, Place / Remove / Buy |
| `app/product/[id].tsx` | New **View in your room** button |
| `src/hooks/useARAvailability.ts` | `isSupported()` + Android camera permission (re-checks after Settings) |
| `src/ar/guidance.ts` | Hint text, `canPlace`, user-facing error / blocked messages |
| `src/store/scene.ts` | Scene reducer (placed ids, selection, placement in progress) |

The AR screen handles every case required by CLAUDE.md 4.1: camera permission denied
(with "Allow camera" / "Open settings"), device without AR, tracking lost (guidance text),
and model download failure (message, item removed, user can retry).

### Seed data

`prod-sofa-oslo` and `prod-chair-mira` now use real-scale sample models (Khronos glTF
Sample Assets, CC BY 4.0, credits in `apps/api/src/data/seed/MODEL_CREDITS.md`), with
dimensions measured from the models. Other products keep placeholder URLs (useful to test
the download-failure path).

---

## 2. Decisions taken

1. **SceneView 2.3.4, not 4.x.** SceneView 3.x/4.x are built with Kotlin ≥ 2.3; React
   Native 0.86 compiles with Kotlin 2.1, which cannot read them. 2.3.4 (maintained, published
   2026-10-10) uses Kotlin 2.2 metadata and has a classic `View` API that fits an Expo view
   directly. Bumping Kotlin for the whole app was judged riskier. Revisit on the next
   Expo SDK upgrade. Recorded in CLAUDE.md §2.
2. **Own gesture handling and picking** instead of SceneView's editable nodes, so the
   move/rotate rules (floor only, Y-axis only, no scale, last valid pose) and the step-3
   collision checks live in one place. Picking uses each item's real-size box, not the mesh.
3. **Permission is asked in JS** (with our own copy and Settings path); the native view
   never shows SceneView's permission toast.
4. **Bottom-center alignment from the bounding box** instead of SceneView's `centerOrigin`
   (which in 2.3.4 shifts by a multiple of the size and would sink a correctly authored model).
5. **iOS stub keeps the contract identical**: same props/events/methods; `isSupported()`
   returns `false` and methods reject with `AR_UNAVAILABLE` until step 4.
6. Contract additions (documented in CLAUDE.md §4.2): error codes `INVALID_ITEM` and
   `CANCELLED`, placement behavior, floor definition.

---

## 3. Fixes made along the way

- **API URL in plain debug builds:** `expoConfig.hostUri` is empty without expo-dev-client,
  so the app fell back to `localhost` (the device itself). It now falls back to the host
  that served the JS bundle. Verified on the emulator without `adb reverse`.
- **Seed changes didn't reload the API:** `tsx watch` only watches imported code. The `dev`
  script now also watches `src/data/seed/**`. (The step 1 doc said it reloaded; corrected.)
- AR screen error/loading states used dark text on the camera's black background; they now
  use the app background.
- **Holes in models up close / while moving (found on device):** SceneView's depth-occlusion
  material hides virtual pixels as soon as the noisy ARCore depth is *slightly* closer, and
  treats "no depth" as "at the lens". Replaced by our own material
  (`android/src/main/materials/furniture_camera_depth.mat`, compiled `.filamat` committed):
  a margin of 6 cm + 4 % of the distance, and missing depth = far. People and furniture
  clearly in front still occlude. Recompile steps in `modules/furniture-ar/README.md`.
- Unselected footprints were drawn fully transparent but still caught floor reflections;
  they are now hidden, and only the selected item shows its footprint.
- Over USB, the app reaches the API through `adb reverse tcp:3333 tcp:3333`
  (`npm run android:device` / `npm run reverse:api`); unplugging the cable drops it.

---

## 4. Verification

| Check | Result |
|---|---|
| Kotlin unit tests (`ArMathTest`) | 12 passed |
| Mobile Jest | 30 passed (scene reducer, guidance, plus step 1 tests) |
| API / shared Vitest | 45 / 6 passed |
| `tsc --noEmit` (all packages) | clean |
| Android debug build + install on emulator | OK |
| Emulator runtime | Product page → **View in your room** → "AR isn't available" (emulator has no ARCore) ✔ |
| **AR on a physical ARCore phone** | **Not done yet** — needs your device |
| iOS stub | Not compiled (no Mac); builds via EAS only |

## 5. How to test on a phone

1. Phone with ARCore support, USB debugging on, same Wi-Fi as the PC.
2. Restart the API once so it serves the new seed: `npm run dev:api`.
3. `cd apps/mobile && npx expo run:android --device` (native code changed, so rebuild).
4. Open **Oslo 3-Seater Sofa** or **Mira Armchair** → **View in your room**.
5. Scan the floor, aim the dot, **Place**. Drag to move, twist to rotate, tap to select,
   **Remove** / **Place another**. Try dragging off the floor (red flash + "Keep it on the floor").

## 6. Known limitations

- No collisions yet (step 3): items can overlap each other and walls.
- No outline shader for selection; the footprint highlight is used instead.
- People occlusion relies on the Depth API (depth occlusion); devices without it show no
  occlusion.
- iOS AR is step 4; snapshot UI (a button) is step 5 — the native method already exists.
