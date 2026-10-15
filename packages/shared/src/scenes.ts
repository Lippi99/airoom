/**
 * Scenes: named arrangements of several products, saved from the AR view.
 *
 * AR world coordinates are only valid inside one AR session, so a scene stores each item's
 * pose **relative to the scene's reference item** (`items[0]`; the app picks a floor item when
 * there is one): the reference is at the origin with yaw 0, the others are offsets in its
 * frame. Each item can also carry its own cloud `anchor`: reopening the scene in the same room
 * puts every item whose anchor is recognized back at exactly its spot, and the others around
 * them. Without any anchor the scene is placed where the user aims.
 */

/** Limits shared by the app (input) and the API (validation). */
export const SCENE_NAME_MAX_LENGTH = 60;
export const SCENE_MAX_ITEMS = 30;

/**
 * Pose relative to the scene's reference item, in its frame: meters along its right (+X),
 * up (+Y) and front (+Z) axes, and yaw (radians, around +Y, counter-clockwise seen from above).
 * Floor items: the bottom-center; wall items: the center of the back face.
 */
export interface ScenePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/**
 * ARCore Cloud Anchor hosted at an item's own pose (its position, yaw around +Y) when the scene
 * was saved. Resolving it in a later session gives that item's pose in that session's world.
 */
export interface SceneAnchor {
  cloudAnchorId: string;
  /** ISO 8601; after this the cloud anchor no longer resolves. */
  expiresAt: string;
}

export interface SceneItemDto {
  productId: string;
  pose: ScenePose;
  /** Absent when the room around the item could not be captured. */
  anchor?: SceneAnchor;
}

export interface SceneDto {
  id: string;
  name: string;
  /** `items[0]` is the reference item (identity pose). */
  items: SceneItemDto[];
  /** ISO 8601. */
  createdAt: string;
  updatedAt: string;
}

/** Body of `POST /scenes` and `PUT /scenes/:id` (replaces name and items, anchors included). */
export interface SaveSceneRequest {
  name: string;
  items: SceneItemDto[];
}
