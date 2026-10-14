import { isWallMounted, type FurnitureCategory } from '@airoom/shared';
import type { ARErrorEvent, PlacementBlockedReason, TrackingState } from '../../modules/furniture-ar';

/** Where the product goes: furniture on the floor, wall art on a wall (CLAUDE.md 4.2). */
export type PlacementSurface = 'floor' | 'wall';

export function surfaceFor(category: FurnitureCategory): PlacementSurface {
  return isWallMounted(category) ? 'wall' : 'floor';
}

export interface GuidanceInput {
  surface: PlacementSurface;
  tracking: TrackingState | null;
  floorCount: number;
  wallCount: number;
  itemCount: number;
  isPlacing: boolean;
}

/** One-line hint shown over the camera, based on what the AR session can do right now. */
export function getGuidance(input: GuidanceInput): string {
  const { surface, tracking, itemCount, isPlacing } = input;
  if (tracking === null) return 'Starting the camera…';
  if (tracking === 'notAvailable') return 'Tracking lost. Point at a well-lit, textured area.';
  if (tracking === 'limited') return 'Move your phone slowly to scan the room.';
  if (isPlacing) return 'Loading the 3D model…';
  if (surface === 'wall') {
    // Plain walls are often never detected as planes; the native side then measures the wall
    // with depth when Place is tapped, which works best a meter or two away, after moving a bit.
    if (itemCount === 0 && input.wallCount === 0) return 'Stand 1-2 m from the wall, move a little, aim the dot, tap Place.';
    if (itemCount === 0) return 'Aim the center dot where its middle should hang, then tap Place.';
    return 'Drag to move it along the wall';
  }
  if (input.floorCount === 0) return 'Point the camera at the floor and move it slowly.';
  if (itemCount === 0) return 'Aim the center dot at the floor, then tap Place.';
  return 'Drag to move · Twist with two fingers to rotate';
}

/**
 * Whether the Place button can be used: tracking, not busy, and for floor items a floor found.
 * Wall items don't wait for a detected wall plane: plain walls may never become one, and the
 * native side can still measure them with depth when Place is tapped (or answers NO_WALL).
 */
export function canPlace({ surface, tracking, floorCount, isPlacing }: GuidanceInput): boolean {
  const surfaceReady = surface === 'wall' || floorCount > 0;
  return tracking === 'normal' && surfaceReady && !isPlacing;
}

const BLOCKED_MESSAGES: Record<PlacementBlockedReason, string> = {
  noFloor: 'Keep it on the floor.',
  noWall: 'Keep it on the wall, above the floor.',
  wall: 'It would go through a wall.',
  item: 'It would overlap another item.',
};

export function blockedMessage(reason: PlacementBlockedReason): string {
  return BLOCKED_MESSAGES[reason];
}

/** User-facing text for an AR error code (rejected method or `onError`). */
export function errorMessage(error: Pick<ARErrorEvent, 'code' | 'message'>, surface: PlacementSurface = 'floor'): string {
  switch (error.code) {
    case 'NO_FLOOR':
      return 'Point the center dot at the floor and try again.';
    case 'NO_WALL':
      return 'Point the center dot at a wall and try again.';
    case 'PLACEMENT_BLOCKED':
      return surface === 'wall'
        ? 'That spot is taken or too low. Aim at a free area of the wall.'
        : 'That spot is taken. Aim at a free area of the floor.';
    case 'NOT_READY':
      return 'Still scanning. Move your phone slowly around the room.';
    case 'MODEL_LOAD_FAILED':
      return 'Could not download the 3D model. Check your connection and try again.';
    case 'CAMERA_PERMISSION_DENIED':
      return 'Camera access is needed to show furniture in your room.';
    case 'AR_UNAVAILABLE':
      return 'AR is not available on this device.';
    default:
      return error.message || 'Something went wrong with AR.';
  }
}

/** Codes thrown by native methods, read from a rejected promise. */
export function errorCodeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code.replace(/^ERR_/, '');
  }
  return 'UNKNOWN';
}
