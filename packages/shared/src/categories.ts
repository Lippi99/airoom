/**
 * Furniture categories known by the app, the API and the native AR module.
 * The value is the category slug. Placement and collision rules depend on it
 * (`rug` lies under furniture, `wall-art` hangs on a wall).
 */
export const FurnitureCategory = {
  Sofa: 'sofa',
  Bed: 'bed',
  Chair: 'chair',
  Table: 'table',
  Rug: 'rug',
  Lamp: 'lamp',
  Storage: 'storage',
  WallArt: 'wall-art',
} as const;

export type FurnitureCategory = (typeof FurnitureCategory)[keyof typeof FurnitureCategory];

export const FURNITURE_CATEGORIES = Object.values(FurnitureCategory) as [
  FurnitureCategory,
  ...FurnitureCategory[],
];

export function isFurnitureCategory(value: unknown): value is FurnitureCategory {
  return typeof value === 'string' && (FURNITURE_CATEGORIES as readonly string[]).includes(value);
}

/** Floor coverings ignore collision with furniture (see CLAUDE.md 4.4). */
export function isFloorCovering(category: FurnitureCategory): boolean {
  return category === FurnitureCategory.Rug;
}

/** Wall-mounted items are placed on a wall instead of the floor (see CLAUDE.md 4.2). */
export function isWallMounted(category: FurnitureCategory): boolean {
  return category === FurnitureCategory.WallArt;
}
