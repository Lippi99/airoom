# Step 1 — Setup

**Status:** done (2026-10-12)
**Roadmap item:** monorepo, shared package, API with in-memory repositories and seed data,
Expo app with catalog and product screens consuming the API.

---

## 1. What was built

### Monorepo

npm workspaces (`apps/*`, `packages/*`), git initialized on `main`.

| Package | Purpose |
|---|---|
| `packages/shared` (`@airoom/shared`) | Types and helpers shared by app and API |
| `apps/api` (`@airoom/api`) | Fastify API, Repository Pattern, in-memory data |
| `apps/mobile` (`@airoom/mobile`) | Expo SDK 57 app with Expo Router |

Root scripts: `npm run dev:api`, `npm run typecheck`, `npm test` (all workspaces).

### `packages/shared`

Consumed as TypeScript source (no build step); Metro, `tsx` and Vitest compile it directly.

- `FurnitureCategory`: `sofa | bed | chair | table | rug | lamp | storage`, plus
  `FURNITURE_CATEGORIES`, `isFurnitureCategory()`, `isFloorCovering()` (rugs).
- Click platforms: `ClickPlatform` (`ios | android`), `RecordedClickPlatform` (adds `unknown`).
- DTOs: `ProductDto`, `CategoryDto`, `RetailerSummaryDto`, `Dimensions`, `ApiErrorDto`, …
- `ApiRoutes` and `buildGoUrl()` — the only way to build a purchase link.

### API (`apps/api`)

Layering follows CLAUDE.md 5.1:

```
http/ (Fastify routes + Zod)  →  services/  →  domain/ (interfaces)  ←  repositories/in-memory/
                                                       container.ts wires the concrete classes
```

| Folder | Contents |
|---|---|
| `domain/` | `Product`, `Category`, `Retailer`, `ClickEvent`; repository interfaces |
| `repositories/in-memory/` | One class per repository + `seed.ts` (loads and validates the JSON seed) |
| `services/` | `ProductService`, `CategoryService`, `ClickService`, `ProductDtoMapper`, `inferPlatformFromUserAgent` |
| `http/` | `app.ts` (`buildApp()`), routes, Zod schemas, error helpers |
| `data/seed/` | `categories.json`, `retailers.json`, `products.json` |

Endpoints:

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{ status: 'ok' }` |
| GET | `/categories` | Category DTOs |
| GET | `/products?category=&search=` | Active products only. Unknown category → 400 |
| GET | `/products/:id` | 404 when missing or inactive |
| GET | `/go/:productId?platform=&sessionId=` | Records a click, then 302 to `affiliateUrl ?? productUrl` |

The seed is validated with Zod at startup (types, URLs, positive dimensions) and checked for
broken references (unknown category/retailer, duplicate ids). A bad seed stops the server
instead of serving bad data.

### Mobile app (`apps/mobile`)

| Path | Purpose |
|---|---|
| `app/_layout.tsx` | Root stack, wraps everything in `FavoritesProvider` |
| `app/(tabs)/index.tsx` | Catalog: search (debounced), category chips, 2-column grid, pull to refresh |
| `app/(tabs)/favorites.tsx` | Saved products |
| `app/product/[id].tsx` | Details, dimensions, Save, **Buy** (via `/go/:productId`) |
| `src/api/client.ts` | Typed fetch client, `ApiError`, `getBuyUrl()` |
| `src/config.ts` | API base URL resolution |
| `src/hooks/` | `useAsync` (abortable loading), `useCatalog`, `useDebouncedValue` |
| `src/store/favorites.tsx` | Favorites context (in memory) |
| `src/components/` | `ProductCard`, `ProductGrid`, `CategoryFilter`, loading/error/empty views, theme |
| `src/utils/format.ts` | Price (device locale) and dimensions (cm) formatting |

**API URL:** `EXPO_PUBLIC_API_URL` if set; otherwise, in development, the host running Metro
on port 3333 (so emulators and phones on the same Wi-Fi work without setup).

---

## 2. Decisions taken

1. **Click tracking never blocks the redirect.** `platform` and `sessionId` are optional and
   validated with Zod; invalid values are dropped. Without `platform`, it is inferred from
   `User-Agent`, falling back to `'unknown'`. If saving the click fails, it is logged and the
   redirect still happens. Only an unknown product returns 404. Inactive products still
   redirect (old shared links keep earning).
2. **Product DTO embeds `category: { id, slug, name }` and `retailer: { id, name }`.** Entities
   keep `categoryId`/`retailerId`; `ProductDtoMapper` assembles the DTO using the repositories.
   The DTO never exposes `productUrl` or `affiliateUrl`.
3. **Generated native folders are not versioned.** `apps/mobile/android/` and `apps/mobile/ios/`
   are git-ignored (Expo prebuild). Also ignored: `node_modules/`, `.expo/`, `dist/`, `.env*`.
4. **No new major dependencies** beyond the CLAUDE.md stack. Dev-only additions: `tsx`
   (runs the API), `jest-expo` and `@testing-library/react-native` (mobile tests).
5. **Single React copy.** The root `package.json` pins `react`/`react-dom` via `overrides`
   to the version Expo expects; a second hoisted copy broke hooks in tests (and would
   break Metro).
6. **TypeScript 6** does not auto-load `@types/*`, so `apps/mobile/tsconfig.json` lists
   `"types": ["jest"]`.

All of the above is also reflected in `CLAUDE.md` (sections 5.2, 5.4, 6).

---

## 3. Tests

| Package | Runner | Tests | Covers |
|---|---|---|---|
| shared | Vitest | 6 | `buildGoUrl`, type guards |
| api | Vitest | 45 | Repositories, seed validation, services, platform inference, HTTP routes (`inject`) |
| mobile | Jest + RNTL | 12 | API client, formatting, `ProductCard`, favorites store |

Also verified: `tsc --noEmit` clean in all packages, `expo-doctor` 21/21, Android JS bundle
exports, API smoke-tested with curl, debug build installed and running on the emulator.

---

## 4. How to run

```bash
npm install                          # repo root

npm run dev:api                      # API on 0.0.0.0:3333 (watch mode)

cd apps/mobile
npx expo run:android                 # first time / after native changes: build + install
npx expo start                       # day to day: JS dev server, then press "a"
```

Edit `apps/api/src/data/seed/*.json` to change the catalog; the API restarts by itself
(the `dev` script watches the seed folder with `--include`, added in step 2 — before that,
seed edits needed a manual restart).

---

## 5. Windows build environment (machine setup, not in git)

The first Android build needed three fixes on the dev machine:

| Problem | Fix |
|---|---|
| Android Studio's bundled JDK is Java 25; its "restricted method" warning fails RN's `configureCMake` tasks | Installed Microsoft OpenJDK 17 and set user `JAVA_HOME` to it |
| CMake object paths reach ~363 chars (project path appears twice), over Windows' 260 limit | `LongPathsEnabled = 1` in `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem` |
| The SDK's `cmake\3.22.1\bin\ninja.exe` (1.10.2) is not long-path aware | Replaced with ninja 1.13.2 (old file kept as `ninja.exe.bak`) |

If Android Studio is used to build, set **Settings → Build Tools → Gradle → Gradle JDK** to 17.
An SDK update that installs another CMake version may bring an old ninja back.

---

## 6. Known limitations / placeholders

- Seed data is fictional: retailers on `example.com`, model URLs on a non-existent
  `cdn.example.com`, thumbnails from placehold.co. Bundle id `com.airoom.app` is a placeholder.
- Favorites live in memory only (persisting needs a storage dependency, e.g. AsyncStorage).
- Only requests are validated with Zod; responses are typed via shared DTOs but not validated.
- The API runs through `tsx`; there is no production build yet.
- No AR yet — that is step 2.
