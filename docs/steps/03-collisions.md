# Step 3 — Collisions

**Status:** implemented and installed on the test phone (Galaxy Z Flip6); **on-device
collision testing pending** (2026-10-12)
**Roadmap item:** `CollisionMath` + wall detection + item-vs-item, multiple items.

## What was built

| Path | Purpose |
|---|---|
| `modules/furniture-ar/collision-cases.json` | **Shared** test cases (30) for Kotlin now and Swift in step 4 |
| `android/.../CollisionMath.kt` | Footprints, SAT (item-item, item-wall), blocking rules |
| `android/src/test/.../CollisionMathTest.kt` | Runs every case in the JSON file |
| `android/.../FurnitureARView.kt` | Walls from vertical planes, per-frame checks on drag/rotate, placement check |

Rules (CLAUDE.md 4.4, items 1–10):

- Footprint = real `width × depth` rectangle rotated by yaw; SAT with a 1 cm margin.
- Walls = tracked vertical planes as floor segments (≥ 20 cm); same SAT test.
- Rugs ignore furniture, still collide with walls and other rugs.
- Blocked move/rotation → last valid pose, red footprint flash, `onPlacementBlocked`
  (`'wall' | 'item' | 'noFloor'`), once per blocked streak.
- **Escape rule:** only obstacles a move *newly* hits block it, so an item overlapping
  something (e.g. a wall detected later) can always be dragged out.
- `placeItem` never creates a collision → rejects with `PLACEMENT_BLOCKED`.

## Also done in this step (from on-device feedback)

- **Floating furniture:** anchors are now attached to the detected floor plane (follow
  ARCore's floor refinements), and each item has a procedural **contact shadow**
  (`materials/furniture_contact_shadow.mat`).
- **Depth occlusion turned off** (`DEPTH_OCCLUSION_ENABLED = false`): even with the margin
  shader, ARCore depth on the test phone cut flickering holes near the image edges. Decision
  pending (CLAUDE.md 4.3 asks for occlusion where supported).
- **New product with a Blender-built model:** *Sol Swivel Armchair* (`prod-chair-sol`), from
  `tools/models/swivel_tub_armchair.py`, served by the API at `/static/...`. Seed asset
  URLs may now be relative (`/static/...`); the API makes them absolute with the host the
  client used (works over USB and Wi-Fi).

## Verification

| Check | Result |
|---|---|
| Kotlin `CollisionMathTest` (30 shared cases) + `ArMathTest` | passed |
| API Vitest (incl. static route, path traversal, URL resolution) | 55 passed |
| Mobile Jest / typecheck | 30 passed / clean |
| Installed on phone | yes |
| Collisions on device | **pending your test** |
