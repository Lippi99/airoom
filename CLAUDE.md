# CLAUDE.md

This file gives Claude (and any developer) the context needed to work on this project.
Read it fully before making changes.

---

## 1. Product overview

A mobile app that lets users place **real-scale 3D furniture models** (sofas, beds, chairs,
tables, rugs, lamps, etc.) and **wall art** (framed paintings, hung on walls) into their real
room using **Augmented Reality (AR)** through the phone camera.

Core user flow:

1. User opens the app and browses a **catalog** of 3D furniture models.
2. User picks an item and opens the **AR view** (camera).
3. The app detects the floor (and walls), and the user **places** the item in the room.
4. The user can **move** and **rotate** the item. Items **cannot collide** with walls or with
   other placed items.
5. The user can add **several different products** to the same AR view (a **scene**), name it
   and **save** it, and reopen it later (Scenes tab). The scene's **shopping list** (tap its
   name) shows each product's price, the total and a Buy button per product; **Share** sends a
   photo of the room with the furniture.
6. Each item has a **purchase link (href)** to the retailer's product page. Tapping
   "Buy" opens it through our tracking redirect.

**Monetization:** affiliate links and retailer partnerships. Every outbound click goes
through the backend (`GET /go/:productId`) so clicks can be tracked.

### Non-goals (for now)

- No 3D modeling inside the app. Models are produced externally (Blender, photogrammetry)
  and uploaded to the catalog.
- No user-controlled scaling. Items are always shown at **real scale (1:1, meters)** so the
  user sees the actual size of the product they would buy.
- No database yet (see section 5.5).

---

## 2. Tech stack

| Layer | Technology |
|---|---|
| Mobile app | **React Native + Expo** (TypeScript, strict mode), **Expo Router** |
| AR (iOS) | Custom Expo native module in **Swift** using **RealityKit + ARKit** |
| AR (Android) | Custom Expo native module in **Kotlin** using **SceneView 2.3.x (Filament) + ARCore** — see note below |
| Native bridge | **Expo Modules API** |
| Backend | **Node.js + TypeScript**, **Repository Pattern** |
| HTTP framework | Fastify (with Zod for validation) |
| Shared types | `packages/shared` (TypeScript), imported by mobile and API |
| 3D formats | **GLB/glTF** (Android), **USDZ** (iOS) |
| Model tooling | Blender, `@gltf-transform/cli`, Reality Converter (macOS) |
| Saved scene positions | **ARCore Cloud Anchors** (keyless auth via Google Play services; setup in `docs/steps/03c-scenes.md`) |
| On-device storage | **AsyncStorage** (`@react-native-async-storage/async-storage`): favorites, as product ids |
| Photo sharing | **expo-sharing** (the AR view's `captureSnapshot` photo) |
| Builds | **EAS Build** (development builds; Expo Go is NOT supported) |
| Tests | Vitest (API, shared), Jest + React Native Testing Library (mobile) |

**SceneView version pin:** SceneView 3.x/4.x are compiled with Kotlin ≥ 2.3, which the
Kotlin 2.1 compiler used by React Native 0.86 cannot read. We use **`arsceneview:2.3.4`**
(maintained 2.x line, classic `View` API). Revisit when the Expo SDK / RN upgrade Kotlin.

### Explicitly NOT used

- **ViroReact / react-viro**: rejected because its rendering quality (lighting estimation,
  contact shadows, occlusion, PBR) is not good enough for realistic furniture.
- **Unity**: rejected to keep the catalog/UI in React and avoid a heavy embedded engine.
- **Expo Go**: cannot load custom native modules or run AR.

---

## 3. Repository structure

npm workspaces monorepo:

```
/
├── CLAUDE.md
├── package.json                  # workspaces: apps/*, packages/*
├── apps/
│   ├── mobile/                   # Expo app
│   │   ├── app/                  # Expo Router screens
│   │   │   ├── (tabs)/
│   │   │   │   ├── index.tsx     # catalog
│   │   │   │   ├── scenes.tsx    # saved scenes (open / delete / new)
│   │   │   │   └── favorites.tsx
│   │   │   ├── product/[id].tsx  # product details
│   │   │   └── ar.tsx            # AR scene editor (uses FurnitureARView)
│   │   ├── src/
│   │   │   ├── api/              # typed API client
│   │   │   ├── ar/               # AR guidance texts, scene layout math
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   └── store/            # scene state (placed items), favorites (kept on device)
│   │   └── modules/
│   │       └── furniture-ar/     # custom Expo native module
│   │           ├── index.ts      # public TS API (the contract)
│   │           ├── src/          # TS types, view component wrapper
│   │           ├── ios/          # Swift + RealityKit
│   │           └── android/      # Kotlin + SceneView
│   └── api/                      # Node.js + TypeScript backend
│       └── src/
│           ├── domain/           # entities + repository interfaces
│           ├── repositories/
│           │   └── in-memory/    # current implementations
│           ├── services/         # business logic
│           ├── http/             # Fastify routes, controllers, schemas
│           ├── data/seed/        # JSON seed data
│           ├── container.ts      # dependency wiring
│           └── server.ts
└── packages/
    └── shared/                   # DTOs, enums, constants shared by app and API
```

---

## 4. Mobile app

### 4.1 General rules

- TypeScript `strict: true`. No `any` without a comment explaining why.
- Functional components and hooks only.
- All API calls go through `src/api/` (typed with `packages/shared` DTOs).
- Never hardcode retailer URLs in the app. Always open `GET {API_URL}/go/:productId`
  (`openBuyPage` in `src/utils/buy.ts` does it for every Buy button).
- The AR screen must handle: camera permission denied, device without AR support,
  tracking lost, and model download failure, each with a clear message to the user.

### 4.2 Native module contract: `furniture-ar`

The TypeScript API in `modules/furniture-ar/index.ts` is the **single source of truth**.
The Swift and Kotlin implementations MUST expose exactly the same props, methods and
events. Any change to the contract must be applied to TS, Swift and Kotlin in the same
change.

```ts
// View component
<FurnitureARView
  ref={arRef}
  style={...}
  showPlaneOverlay={boolean}
  onTrackingStateChanged={(e: { state: 'notAvailable' | 'limited' | 'normal' }) => void}
  onPlaneDetected={(e: { kind: 'floor' | 'wall'; count: number }) => void}
  onItemPlaced={(e: { instanceId: string; productId: string }) => void}
  onItemSelected={(e: { instanceId: string | null }) => void}
  onPlacementBlocked={(e: { instanceId: string; reason: 'wall' | 'item' | 'noFloor' | 'noWall' }) => void}
  onItemTapped={(e: { instanceId: string; productId: string }) => void}
  onItemRemoved={(e: { instanceId: string; productId: string }) => void} // deleted by the user (trash)
  onError={(e: { code: string; message: string }) => void}
/>

// Imperative methods (via ref)
arRef.current.placeItem(item: ARItem): Promise<void>
arRef.current.removeItem(instanceId: string): Promise<void>
arRef.current.clearScene(): Promise<void>
arRef.current.captureSnapshot(): Promise<{ uri: string }>   // photo of the scene
arRef.current.getPlacedItems(): Promise<ARPlacedItem[]>      // loaded items + world poses, placement order
arRef.current.hostItemAnchor(instanceId: string): Promise<{ cloudAnchorId: string; ttlDays: number }> // cloud anchor at the item (365 d)
arRef.current.resolveCloudAnchor(cloudAnchorId: string): Promise<ARPose> // once recognized and settled; several at once
arRef.current.stopResolvingCloudAnchors(): Promise<void>                 // pending resolves reject with CANCELLED

type ARItem = {
  instanceId: string;          // unique per placed copy
  productId: string;
  category: FurnitureCategory; // from packages/shared
  glbUrl: string;              // used on Android
  usdzUrl: string;             // used on iOS
  dimensions: { width: number; depth: number; height: number }; // meters (wall art: depth = off the wall)
  pose?: ARPose;               // restoring: place here instead of aiming
  cloudAnchorId?: string;      // restoring: place on this resolved cloud anchor and follow it
};
type ARPose = { x: number; y: number; z: number; yaw: number }; // world, this AR session only
type ARPlacedItem = { instanceId: string; productId: string; pose: ARPose; cloudAnchorId?: string }; // anchor at its spot, until moved
```

Platform support check: `FurnitureAR.isSupported(): Promise<boolean>`.

Behavior details (same on both platforms):

- `placeItem` hit-tests the screen center against the floor **when called**, anchors there,
  then downloads the model (the footprint is shown while it loads) and resolves once the
  model is in the scene. The item initially faces the camera.
- **Wall-mounted items** (category `wall-art`, `isWallMounted` in `packages/shared`) hit-test
  a detected **wall** (vertical plane) instead: the hit point becomes the item's center, its
  back flat on the wall, its front facing out of the wall toward the camera's side, anchored
  on the wall plane. Plain walls ARCore never turns into planes are measured instead: a 3x3
  grid of Depth API / feature-point hits around the screen center, fitted as a vertical wall
  (`ArMath.wallYawFromPoints`), so the app doesn't wait for a wall plane before Place. Misses reject with `NO_WALL` (also `onPlacementBlocked` with
  `reason: 'noWall'`); a spot where its bottom edge would go into the floor rejects with
  `PLACEMENT_BLOCKED` (reason `'noWall'`).
- Rejection / `onError` codes: `NOT_READY` (not tracking), `NO_FLOOR` (also emits
  `onPlacementBlocked` with `reason: 'noFloor'`), `NO_WALL` (wall items), `DUPLICATE_INSTANCE`, `INVALID_ITEM`,
  `CANCELLED` (item removed while its model was loading), `PLACEMENT_BLOCKED` (spot
  crosses a wall or overlaps an item; also emits `onPlacementBlocked` with the reason),
  `MODEL_LOAD_FAILED` (also emitted via `onError`), `CAMERA_PERMISSION_DENIED`,
  `AR_UNAVAILABLE`, `SESSION_FAILED`, `SNAPSHOT_FAILED`, and for cloud anchors
  `CLOUD_ANCHOR_NOT_AUTHORIZED`, `CLOUD_ANCHOR_LOW_QUALITY`, `CLOUD_ANCHOR_NOT_FOUND`,
  `CLOUD_ANCHOR_FAILED`. The list lives in
  `ARErrorCode` (`src/FurnitureAR.types.ts`).
- The JS screen requests the camera permission **before** mounting the view; the native
  view never shows its own permission UI.
- "Floor" = upward-facing planes within 15 cm of the lowest one (so tables don't count).
- Models are aligned so their bounding-box bottom-center sits on the anchor (wall items: the
  center of the back face; a no-op for models authored to 4.5), and are never scaled.

### 4.3 AR interaction rules

- **Placement:** items are placed on a detected **horizontal floor plane** at the point
  where the screen center raycast hits the floor.
- **Move:** one-finger drag moves the selected item along the floor plane (X/Z only).
- **Rotate:** two-finger twist rotates the selected item around the **vertical (Y) axis
  only**. No tilt.
- **Scale:** disabled. Items always render at 1:1 real scale.
- **Selection:** tapping an item selects it (subtle outline/highlight). Tapping empty
  space deselects.
- **Move arrows:** the selected item shows four arrows, one past the middle of each edge
  (floor items: on the floor, in the item's own left/right/back/front; wall art: on the wall,
  left/right/up/down). Tap = move 5 cm; hold = repeat. Same checks as a drag (collisions,
  floor, wall art above the floor). Drawn on top of everything; an arrow wins over the item
  behind it on touch-down.
- **Delete:** a double tap on an item shows a trash button over it; tapping it removes the
  item and emits `onItemRemoved`. Any other tap dismisses it.
- **Scenes:** several different products per AR session; a saved scene stores poses relative
  to a reference item (`items[0]`, the first floor item). Saving also hosts **one cloud anchor
  per item**, at its own pose (each waits until its item has been seen well; items still at an
  earlier anchor keep it). Reopening looks for all anchors at once: each item comes back at
  **its own spot** as soon as its anchor is recognized and has settled (~1.5 s), and keeps
  following the anchor while ARCore refines it, until the user moves it. Items whose anchor
  isn't found within 4 s of the first one (or that have none) are placed around the found ones
  (least-squares fit). No anchor found ("Place it where I point instead", not set up,
  expired): the scene is rebuilt around the point the screen center aims at. See
  `docs/steps/03c-scenes.md`.
- **Floor items stay on the floor:** about 5 times a second (not while dragged or nudged) the
  floor under each floor item is measured, from the detected floor plane under its center or
  else from depth / feature-point hits under its footprint, and the item is eased onto it
  (smoothed, 3 mm dead-band, offsets over 15 cm ignored). Once settled over a floor plane it
  is anchored on it.
- **Wall art:** one-finger drag slides it along the plane of the wall it hangs on (the
  infinite plane, so it can move past the patch ARCore has detected; corners are caught by
  collisions). No rotation: it always faces out of its wall and stays level. Its bottom edge
  may not go below the floor (`reason: 'noWall'`). The selection highlight is a border on
  the wall around it, and it casts a soft drop shadow on the wall.
- **Wall art stays flush with the wall:** about 5 times a second (not while dragged) the
  wall behind each hung item is re-measured, from a detected wall plane at its center or
  from depth/feature-point samples spread over its whole back face, and the item is eased
  onto it (angle and distance; smoothed, 0.5°/3 mm dead-band, jumps over 20°/10 cm ignored).
  The first estimate at placement covers only a small patch; a few degrees of error there
  shows as an edge off the wall when viewed from the side. Items stay flat: on a curved wall
  they sit tangent to it at their center, like a real frame.
- **Visual realism (required):** environment lighting/reflections from the AR session,
  soft contact shadows on the floor, PBR materials, and people occlusion where the device
  supports it (LiDAR on iOS / Depth API on Android).
  - **Android deviations (on-device findings, step 3):** SceneView 2.3.4's
    `ENVIRONMENTAL_HDR` integration tinted materials green and gave near-black ambient light,
    so Android uses `AMBIENT_INTENSITY` estimation (room brightness + color balance) over a
    fixed neutral studio IBL for ambient/reflections. Depth occlusion is off
    (`DEPTH_OCCLUSION_ENABLED`) because ARCore depth noise cut holes in models. Revisit both
    on a SceneView upgrade.

### 4.4 Collision rules

Collision is computed **natively** (Swift/Kotlin) every frame during a drag or rotate,
because sending poses over the JS bridge per frame is too slow. Both platforms MUST
implement the same algorithm:

1. **Footprint:** each item is represented by its oriented bounding box projected on the
   floor (a rotated rectangle on the X/Z plane), computed from `dimensions` and the
   current Y rotation.
2. **Item vs item:** use the Separating Axis Theorem (SAT) between two rotated
   rectangles, with a safety margin of **1 cm**.
3. **Item vs wall:** detected vertical planes are treated as line segments on the X/Z
   plane. A footprint may not cross or touch a wall segment (margin **1 cm**).
4. **Floor coverings (rugs):** category `rug` ignores collision with furniture and wall art
   (furniture can stand on rugs) but still collides with walls and with other rugs.
5. **Blocked movement:** when a move or rotation would cause a collision, the item stays
   at its **last valid pose**, flashes a red highlight, and the view emits
   `onPlacementBlocked`.
6. **No floor:** an item may not be moved to a point where the raycast does not hit a
   detected floor plane (`reason: 'noFloor'`).

Keep the pure geometry (rectangle from dimensions + rotation, SAT test, segment
intersection) in an isolated, unit-tested file on each platform
(`CollisionMath.swift`, `CollisionMath.kt`), using the same test cases on both.
The shared cases live in `modules/furniture-ar/collision-cases.json`; both platforms' tests
read that file. Add new cases there, never in one platform only.

Implementation details (both platforms):

7. **Escape rule:** a move is blocked only by obstacles it *newly* hits. Obstacles the
   current pose already overlaps (e.g. a wall detected after placement) are ignored, so an
   item can always be dragged out of an overlap. Walls take priority over items.
8. **Walls** = tracked, non-subsumed vertical planes, as the floor segment spanned by their
   detected polygon; planes narrower than 20 cm are ignored.
9. **Placement** never creates a collision: `placeItem` on a blocked spot rejects with
   `PLACEMENT_BLOCKED`.
10. `onPlacementBlocked` fires once per blocked streak (again if the reason changes), not
    every frame.
11. **Height ranges:** every footprint also has a vertical range (floor items: floor to
    `height`; wall art: centered on its anchor). Two items collide only if their footprints
    *and* height ranges overlap (1 cm margin), so a painting can hang above a sofa but not
    behind a tall bookcase. Without a range an item spans all heights (the plain 2D rules).
12. **Wall art and walls:** a wall item ignores its **host wall**: any wall segment parallel
    to its back (within ~10°) and within 6 cm of it (ARCore often detects one wall as several
    planes). Other walls still block it (e.g. sliding into a corner). Its footprint is the
    `width × depth` rectangle in front of the wall.
13. **Restored items are never blocked:** items placed with `pose` or `cloudAnchorId` (a saved
    scene coming back) skip the placement checks. The saved arrangement was valid; today's
    anchor, wall and floor estimates are each a few cm off, so a chair saved against a wall or
    a painting on it would otherwise go missing. The escape rule (7) lets the user move them.

### 4.5 3D model requirements

- Units in **meters**, real-world dimensions (must match the retailer's specs).
- **Y-up**, origin at the **bottom center** of the item (so it sits on the floor).
  **Wall art:** origin at the **center of the back face** (the point on the wall), front
  toward +Z; `dimensions.depth` is how far it stands off the wall.
- PBR textures (base color, normal, roughness/metallic, AO), **2K**. Don't go to 4K: at
  phone viewing distance it adds no visible detail, and each 4K texture takes ~85 MB of GPU
  memory once decoded (several placed items would stutter or crash mid-range phones).
- Target file size: **≤ 5 MB** per model, **uncompressed** (no Draco/Meshopt/KTX2: plain
  glTF/USDZ keeps loading simple on SceneView and RealityKit). Stay under the limit by
  removing hidden geometry and keeping textures at 2K, not by compressing.
- Each product ships both `model.glb` and `model.usdz`.
- **Contact shadow (floor items):** the GLB carries a baked contact shadow: a flat quad named
  `ContactShadow` 1.5 mm above the floor, unlit black with the ambient occlusion the model casts
  on the floor as alpha (dark under each leg, soft under the seat; ~0.1 MB). The Android view
  then hides its generic shadow and keeps the quad from casting shadows. The USDZ leaves it out
  (RealityKit has grounding shadows). `tools/models/modelkit.py` `contact_shadow()` makes it.
- Models are downloaded on demand and cached on device. Never bundled in the app binary.
- Procedurally built models live in `tools/models/` (Blender Python scripts; see its
  README). During development the API serves `apps/api/static/` at `/static/*`, and seed
  asset URLs may be relative (`/static/...`); the HTTP layer makes them absolute with the
  request's host. Production assets go on a CDN.

---

## 5. Backend (Node.js + TypeScript)

### 5.1 Architecture: Repository Pattern

```
HTTP (routes/controllers) → Services → Repository interfaces → Implementations
```

- **Domain** (`src/domain/`): entities and repository **interfaces** only. No framework
  or storage code.
- **Repositories** (`src/repositories/`): implementations of the interfaces. Currently
  only `in-memory/`, loaded from `src/data/seed/*.json`.
- **Services** (`src/services/`): business logic. Depend on repository **interfaces**,
  never on concrete implementations.
- **HTTP** (`src/http/`): Fastify routes, Zod request/response schemas, controllers.
  Controllers call services only.
- **Container** (`src/container.ts`): the only place that instantiates concrete
  repositories and injects them into services (constructor injection).

### 5.2 Entities

```ts
Product      { id, name, description, categoryId, retailerId, price, currency,
               dimensions: { width, depth, height }, thumbnailUrl,
               model: { glbUrl, usdzUrl, sizeBytes }, productUrl, affiliateUrl?, active }
Category     { id, slug, name }   // sofa, bed, chair, table, rug, lamp, storage, wall-art
Retailer     { id, name, websiteUrl, affiliateProgram? }
ClickEvent   { id, productId, timestamp, platform: 'ios' | 'android' | 'unknown', sessionId? }
Scene        { id, name, items: { productId, pose: { x, y, z, yaw }, anchor?: { cloudAnchorId, expiresAt } }[],
               createdAt, updatedAt }
             // items[0] = reference item; poses relative to it (ScenePose in packages/shared)
```

- `Category.slug` is typed as the `FurnitureCategory` union from `packages/shared`.
- Entities reference each other by id (`Product.categoryId`, `Product.retailerId`). Response
  DTOs embed related objects (see 5.4); that assembly is done by services/mappers using the
  repositories, never by changing the entities.

### 5.3 Repository interfaces

```ts
interface ProductRepository {
  findAll(filter?: { categoryId?: string; search?: string; active?: boolean }): Promise<Product[]>;
  findById(id: string): Promise<Product | null>;
}
interface CategoryRepository { findAll(): Promise<Category[]>; findBySlug(slug: string): Promise<Category | null>; }
interface RetailerRepository { findById(id: string): Promise<Retailer | null>; }
interface ClickEventRepository { save(event: ClickEvent): Promise<void>; countByProduct(productId: string): Promise<number>; }
interface SceneRepository {
  findAll(): Promise<Scene[]>;                 // most recently updated first
  findById(id: string): Promise<Scene | null>;
  save(scene: Scene): Promise<void>;           // insert or replace
  delete(id: string): Promise<boolean>;
}
```

### 5.4 Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/categories` | List categories |
| GET | `/products?category=&search=` | List active products |
| GET | `/products/:id` | Product details (incl. model URLs and dimensions) |
| GET | `/go/:productId?platform=&sessionId=` | Record a `ClickEvent`, then **302 redirect** to `affiliateUrl ?? productUrl` |
| GET | `/scenes` | Saved scenes, most recently updated first |
| GET | `/scenes/:id` | One scene |
| POST | `/scenes` | Create `{ name, items }` → 201 (400 `UNKNOWN_PRODUCT` for products not in the catalog) |
| PUT | `/scenes/:id` | Replace name and items |
| DELETE | `/scenes/:id` | 204 |

**Product DTO:** both `/products` and `/products/:id` return
`category: { id, slug, name }` (slug typed as `FurnitureCategory`) and
`retailer: { id, name }`. The DTO never exposes `productUrl` or `affiliateUrl`; the app
only knows `/go/:productId`.

**`/go/:productId` rules** (a lost click costs money, incomplete data does not):

- Opened via `Linking.openURL`, so the app cannot send headers; data goes in the query string.
- `platform` (`'ios' | 'android'`) and `sessionId` are **optional**. If `platform` is
  missing or invalid, infer it from the `User-Agent` header; if that fails, record
  `'unknown'`. Invalid query values never block the redirect.
- If saving the `ClickEvent` fails, log the error and **still redirect**.
- Only an unknown `productId` returns 404.

### 5.5 Database (not connected yet)

- Do **not** add a database driver, ORM, or migrations yet.
- All data comes from in-memory repositories seeded from JSON.
- When a database is added later, only new classes in `src/repositories/<db>/` and the
  wiring in `container.ts` should change. Services, domain and HTTP must not change.
  Design every change with this in mind.

---

## 6. Development environment

- Primary dev machine: **Windows** + VS Code. Android Studio provides the SDK, emulator,
  `adb`, Logcat and Kotlin debugging (open `apps/mobile/android/` in Android Studio).
- `ANDROID_HOME` must point to the Android SDK; `platform-tools` must be on `PATH`.
- **AR only runs on physical devices.** Android device must support ARCore.
- iOS native code requires a Mac with Xcode to develop/debug. Without a Mac, iOS builds
  use EAS Build in the cloud.
- `apps/mobile/android/` and `apps/mobile/ios/` are **generated** by `expo prebuild` and are
  git-ignored. Never edit them by hand; configure native behavior via `app.json` / config
  plugins. Our native code lives in `apps/mobile/modules/furniture-ar/` and is versioned.
- The mobile app reads the API base URL from `EXPO_PUBLIC_API_URL` (e.g.
  `http://192.168.0.10:3333`). Without it, in development it uses the host that served the
  JS bundle. Over USB that host is `localhost` (Metro is tunnelled with `adb reverse`), so
  the API port must be tunnelled too: `adb reverse tcp:3333 tcp:3333` (see commands).
  `.env*` files are git-ignored.
- Expo ships breaking changes every SDK. Check the versioned docs for the installed SDK
  (`https://docs.expo.dev/versions/v<major>.0.0/`) and add Expo packages with
  `npx expo install` so versions match the SDK.

### Commands

```bash
npm install                                   # root, installs all workspaces

# API
npm run dev -w apps/api                       # start API in watch mode
npm test -w apps/api

# Mobile
npx expo prebuild -p android                  # (re)generate native android project
npx expo run:android --device                 # build + run on connected device
npm run android:device -w apps/mobile         # same, plus `adb reverse` for the API port (USB)
npm run reverse:api -w apps/mobile            # re-tunnel API port 3333 after replugging the phone
# Without USB (Android 11+ Wireless debugging, phone and PC on the same Wi-Fi): pair once with the
# code from "Pair device with pairing code", then everything above (installs, adb reverse) works
adb pair <ip>:<pairing-port> <code>           # once per PC
adb connect <ip>:<port>                       # after a phone restart / Wi-Fi change
npx expo start --port 8081                    # dev server; never with CI=1 (it never reloads code)
eas build --profile development -p android    # cloud dev build
eas build --profile development -p ios        # cloud dev build (no Mac needed)
npm test -w apps/mobile
```

---

## 7. Roadmap

1. **Setup:** monorepo, shared package, API with in-memory repositories and seed data,
   Expo app with catalog and product screens consuming the API.
2. **Android AR (first, dev machine is Windows):** `furniture-ar` module with SceneView,
   floor detection, placing one item, move and rotate.
3. **Collisions:** `CollisionMath` + wall detection + item-vs-item, multiple items.
4. **iOS AR:** RealityKit implementation of the same contract.
5. **Polish:** snapshot capture, buy button via `/go/:productId`, error states.
6. **Database:** new repository implementations (DB to be chosen).

---

## 8. Rules for Claude

- Follow the structure and patterns above. Ask before introducing a new major dependency.
- Keep the `furniture-ar` contract identical across TS, Swift and Kotlin.
- Never connect a database or add an ORM until explicitly asked.
- Services depend on repository interfaces, never on in-memory classes.
- Never let the app open retailer URLs directly; always use `/go/:productId`.
- Never add user scaling of models.
- Write unit tests for services, repositories and collision math.
- Code, comments, commit messages and docs in **English**.
