# furniture-ar

Native AR view for placing real-scale furniture. The contract (props, events, methods) is
defined in `src/FurnitureAR.types.ts` and documented in CLAUDE.md §4.2–4.4.

| Platform | Stack | Status |
|---|---|---|
| Android | Kotlin, SceneView 2.3.4 (Filament 1.68.2), ARCore | Implemented (steps 2-3, wall art, scenes + on-scene controls) |
| iOS | Swift, RealityKit, ARKit | Contract stub (step 4) |

Floor items stand on the floor; wall items (category `wall-art`) hang on walls: placed on a
vertical plane, dragged along it, never rotated, with an origin at the center of their back
face (CLAUDE.md 4.2-4.5). The iOS implementation must do the same.

Saved scenes (docs/steps/03c-scenes.md): one ARCore Cloud Anchor per item (`hostItemAnchor`),
resolved all at once on reopening (`resolveCloudAnchor`, reported after ~1.5 s of settling);
restored items follow their anchor until the user moves them. Floor items are kept on the
measured floor (~5 Hz). Models may bring a baked `ContactShadow` node, which replaces the
generic shadow. Needs the Google Cloud setup described in that doc.

## Android: custom Filament materials

Same procedure for `furniture_contact_shadow.mat` (soft shadow under items without a baked one) and
`furniture_icon.mat` (move arrows and trash button, drawn procedurally on top of everything;
see docs/steps/03c-scenes.md); replace the file names in the `matc` command.

`android/src/main/materials/furniture_camera_depth.mat` is the camera background with depth
occlusion. It replaces SceneView's default to add a depth margin (no holes in furniture
up close / while moving). The compiled file
`android/src/main/assets/materials/furniture_camera_depth.filamat` is committed, because
Gradle cannot compile Filament materials.

To recompile after editing the `.mat`:

1. Get Filament's `matc` for the **same material version** as SceneView's Filament
   (Filament 1.68.x → material version 68). Windows: extract `bin/matc.exe` from
   `filament-v1.68.3-windows.tgz` on the Filament GitHub releases page.
2. From `android/src/main/materials/`:
   ```bash
   matc -p mobile -a opengl -a vulkan -o ../assets/materials/furniture_camera_depth.filamat furniture_camera_depth.mat
   ```
3. Rebuild the app (`npx expo run:android`).

When SceneView is upgraded, check its Filament version and recompile with a matching `matc`;
a material version mismatch fails at runtime.

## Tests

```bash
cd apps/mobile/android
./gradlew :furniture-ar:testDebugUnitTest   # ArMath (rays, picking, twist, walls) + CollisionMath (shared JSON cases)
```
