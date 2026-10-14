# Step 3b — Wall art

**Status:** implemented on Android and **confirmed on the test phone** (Galaxy Z Flip6,
2026-10-13): placement on a plain wall (depth fallback) and staying flush with the wall when
viewed from the side (continuous refinement). iOS: contract stub (step 4).
**Goal:** place framed paintings (category `wall-art`) on walls, not the floor.

## What was built

| Path | Change |
|---|---|
| `packages/shared/src/categories.ts` | Category `wall-art` + `isWallMounted()` |
| `apps/api/src/data/seed/*` | "Wall Art" category; `prod-art-knights` (framed canvas) |
| `modules/furniture-ar/src/FurnitureAR.types.ts` | Reason `'noWall'`, error code `NO_WALL`, wall-art docs on `placeItem` and `dimensions` |
| `android/.../CollisionMath.kt` | Optional height range per footprint; wall-mounted bodies; `isHostWall` |
| `modules/furniture-ar/collision-cases.json` | +3 height cases, new `hostWall` section (7), +10 wall-art rules |
| `android/.../ArMath.kt` | `intersectPlane`, `forward`, `wallItemBox`, `yawOutOfWall` (+ tests) |
| `android/.../FurnitureARView.kt`, `PlacedItem.kt` | Wall hit-test and anchoring, wall drag, no twist, halo + drop shadow on the wall, back-center model alignment |
| `apps/mobile/src/ar/guidance.ts`, `app/ar.tsx` | Placement surface per product: wall count, hints, messages |
| `tools/models/framed_painting.py` | The painting model (origin at the back center) |

## Behavior (CLAUDE.md 4.2-4.5)

- **Place:** aim the center dot where the painting's middle should be; the screen-center
  ray must hit a detected wall (vertical plane, inside its polygon). The painting's back lies
  flat on the wall, facing out toward the camera's side; it is anchored on the wall plane.
  `NO_WALL` if the ray misses a wall; `PLACEMENT_BLOCKED` if the spot is taken or the bottom
  edge would go into the floor.
- **Move:** one-finger drag slides it along its wall's **infinite plane** (ray-plane
  intersection), so it can move beyond the small patch ARCore has detected. It stays above
  the floor (`'noWall'`). No two-finger rotation.
- **Collisions:** items now have height ranges. A painting above a sofa is fine; behind a
  tall bookcase, overlapping another painting, or sliding into a corner wall is blocked.
  The painting ignores its own (host) wall, including duplicate planes ARCore detects for
  the same wall (parallel within ~10°, ≤ 6 cm from its back). Rugs ignore wall art.
- **Look:** selection/blocked highlight is a border on the wall around the painting; a soft
  drop shadow sits on the wall behind it (the contact-shadow quad, turned upright).

## Known limits

- **Plain walls (on-device finding, 2026-10-13):** ARCore did not detect the test wall as a
  plane at all. Fallback: when no wall plane is under the dot, `placeItem` takes a 3x3 grid
  of Depth API / feature-point hits around it (±12% of the screen), fits them as a vertical
  wall (least-squares line seen from above, outliers such as a floor sample dropped), faces
  the painting out of it and snaps it onto the fitted surface. Place is enabled without a
  detected wall; the hint says to stand 1-2 m away and move a little (depth needs motion).
  Needs a phone with the Depth API (the test phone has it); otherwise `NO_WALL`.
- **Misaligned from the side (on-device finding, 2026-10-13):** the placement estimate
  (depth samples at ±18% of the screen) can be a few degrees off, which shows as one edge
  floating off the wall when walking sideways. Fix: continuous refinement (CLAUDE.md 4.3):
  ~5 Hz, samples across the painting's whole back face (or a wall plane when detected),
  smoothed onto the measured wall. `ArMath.project` maps those wall points to screen pixels.
- Paintings stay flat: on a curved wall they touch at their center, like real frames.
- Paintings can't be moved to another wall by dragging; remove and place again.
- iOS: RealityKit implementation still pending (step 4); the contract and shared collision
  cases are ready for it.

## Verification

| Check | Result |
|---|---|
| Kotlin `CollisionMathTest` (all shared cases incl. wall art) + `ArMathTest` (16) | passed |
| Shared Vitest | 7 passed |
| API Vitest | 56 passed |
| Mobile Jest / typecheck | 37 passed / clean |
| Installed on phone (debug build, `gradlew :app:installDebug`) | yes |
| Wall art on device (plain wall, side views) | confirmed by the user |

### Device test checklist

1. Catalog → "Wall Art" → Harlequin Knights → View in your room.
2. Point at a wall, move slowly until "Aim the center dot…" appears; tap Place at eye height.
3. The painting should be flat on the wall, level, real size (1.20 × 0.90 m), with a soft
   shadow behind it.
4. Drag it: it slides along the wall, also past the detected patch; it stops at the floor
   and at a corner wall (red border + message).
5. Two-finger twist does nothing. Place a second copy: it can't overlap the first.
6. Open a sofa in another session/room check: furniture still behaves as before.
