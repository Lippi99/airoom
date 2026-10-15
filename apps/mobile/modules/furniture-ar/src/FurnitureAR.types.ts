import type { Dimensions, FurnitureCategory } from '@airoom/shared';
import type { StyleProp, ViewStyle } from 'react-native';

/**
 * Contract of the `furniture-ar` native module (CLAUDE.md 4.2).
 * Swift (ios/) and Kotlin (android/) MUST expose exactly these props, methods and events.
 * Any change here must be applied to all three in the same change.
 */

export type ARItem = {
  /** Unique per placed copy. */
  instanceId: string;
  productId: string;
  category: FurnitureCategory;
  /** Used on Android. */
  glbUrl: string;
  /** Used on iOS. */
  usdzUrl: string;
  /**
   * Real-world size in meters. For wall-mounted items (`wall-art`): `width` along the wall,
   * `height` vertical, `depth` how far it stands off the wall.
   */
  dimensions: Dimensions;
  /**
   * Restoring a saved scene: place at this world pose instead of where the screen center hits.
   * Floor items stand on the floor detected under it; wall items snap onto the wall nearby.
   * Not blocked by collisions (the saved arrangement was valid; today's estimates are a few cm
   * off), and the user can move it afterwards.
   */
  pose?: ARPose;
  /**
   * Restoring a saved scene: place on this cloud anchor, already found with
   * `resolveCloudAnchor`, and keep the item on it while ARCore refines its position (until
   * the user moves the item). Takes precedence over `pose`. Rejects with
   * `CLOUD_ANCHOR_NOT_FOUND` if the anchor was not resolved.
   */
  cloudAnchorId?: string;
};

/**
 * Pose in the AR session's world (meters, Y up; yaw in radians around +Y, counter-clockwise
 * seen from above). Floor items: bottom-center; wall items: center of the back face. Only
 * valid within the current AR session.
 */
export type ARPose = { x: number; y: number; z: number; yaw: number };

/**
 * A placed item whose model is loaded, with its current pose. `cloudAnchorId`: the cloud
 * anchor at the item's spot (it was restored from it or hosted there with `hostItemAnchor`),
 * absent once the user has moved it.
 */
export type ARPlacedItem = { instanceId: string; productId: string; pose: ARPose; cloudAnchorId?: string };

export type TrackingState = 'notAvailable' | 'limited' | 'normal';
export type PlaneKind = 'floor' | 'wall';
/** `noFloor`: a floor item left the floor. `noWall`: a wall item left the wall or would go into the floor. */
export type PlacementBlockedReason = 'wall' | 'item' | 'noFloor' | 'noWall';

export type TrackingStateChangedEvent = { state: TrackingState };
export type PlaneDetectedEvent = { kind: PlaneKind; count: number };
export type ItemPlacedEvent = { instanceId: string; productId: string };
export type ItemSelectedEvent = { instanceId: string | null };
export type PlacementBlockedEvent = { instanceId: string; reason: PlacementBlockedReason };
export type ItemTappedEvent = { instanceId: string; productId: string };
/** The user deleted an item in the view (double tap, then the trash icon). */
export type ItemRemovedEvent = { instanceId: string; productId: string };
export type ARErrorEvent = { code: ARErrorCode | (string & {}); message: string };

/**
 * Error codes used by `onError` and by rejected method promises.
 * Native code may add codes; these are the ones the app handles explicitly.
 */
export type ARErrorCode =
  | 'CAMERA_PERMISSION_DENIED'
  | 'AR_UNAVAILABLE'
  | 'SESSION_FAILED'
  | 'MODEL_LOAD_FAILED'
  | 'NO_FLOOR'
  | 'NO_WALL'
  | 'PLACEMENT_BLOCKED'
  | 'DUPLICATE_INSTANCE'
  | 'INVALID_ITEM'
  | 'CANCELLED'
  | 'NOT_READY'
  | 'SNAPSHOT_FAILED'
  // Cloud anchors (saved scenes coming back at the same spot in the room):
  /** The app is not authorized for ARCore Cloud Anchors (Google Cloud setup). */
  | 'CLOUD_ANCHOR_NOT_AUTHORIZED'
  /** Not enough of the room seen to save its spot: look around the items, then try again. */
  | 'CLOUD_ANCHOR_LOW_QUALITY'
  /** The anchor expired or does not exist. */
  | 'CLOUD_ANCHOR_NOT_FOUND'
  /** Network, quota or service error. */
  | 'CLOUD_ANCHOR_FAILED';

type NativeEvent<T> = { nativeEvent: T };

export type FurnitureARViewProps = {
  style?: StyleProp<ViewStyle>;
  showPlaneOverlay?: boolean;
  onTrackingStateChanged?: (e: NativeEvent<TrackingStateChangedEvent>) => void;
  onPlaneDetected?: (e: NativeEvent<PlaneDetectedEvent>) => void;
  onItemPlaced?: (e: NativeEvent<ItemPlacedEvent>) => void;
  onItemSelected?: (e: NativeEvent<ItemSelectedEvent>) => void;
  onPlacementBlocked?: (e: NativeEvent<PlacementBlockedEvent>) => void;
  onItemTapped?: (e: NativeEvent<ItemTappedEvent>) => void;
  onItemRemoved?: (e: NativeEvent<ItemRemovedEvent>) => void;
  onError?: (e: NativeEvent<ARErrorEvent>) => void;
};

/** Imperative methods, called through a ref. */
export type FurnitureARViewRef = {
  /**
   * Places the item where the screen-center ray hits the floor; rejects with `NO_FLOOR` if
   * it misses. Wall-mounted items (`wall-art`) hang where the ray hits a wall instead (the
   * hit point becomes the item's center, its back flat on the wall); rejects with `NO_WALL`.
   * With `item.pose`, places it at that pose instead (no aiming).
   */
  placeItem(item: ARItem): Promise<void>;
  /** Removes an item. Does not emit `onItemRemoved` (that is for removals by the user). */
  removeItem(instanceId: string): Promise<void>;
  clearScene(): Promise<void>;
  /** Photo of the AR scene (camera + furniture). `uri` is a local file URI. */
  captureSnapshot(): Promise<{ uri: string }>;
  /** Placed items (models loaded) with their current world poses, in placement order. */
  getPlacedItems(): Promise<ARPlacedItem[]>;
  /**
   * Saves a placed item's spot in the room to ARCore Cloud Anchors: an anchor at its current
   * pose (position + yaw), kept `ttlDays`. Waits until the item has been in view while ARCore
   * rates the surroundings good enough (up to ~15 s, then uploads anyway). Several items can
   * be hosted at once. `CLOUD_ANCHOR_LOW_QUALITY` if the server finds too little.
   */
  hostItemAnchor(instanceId: string): Promise<{ cloudAnchorId: string; ttlDays: number }>;
  /**
   * Finds a hosted anchor again, as long as it takes: resolves with its pose in this session's
   * world once the camera has recognized the spot and the pose has settled (~1.5 s). Several
   * anchors can be looked for at once. The anchor is then kept for `placeItem({ cloudAnchorId })`.
   */
  resolveCloudAnchor(cloudAnchorId: string): Promise<ARPose>;
  /** Stops looking for anchors: pending `resolveCloudAnchor` calls reject with `CANCELLED`. */
  stopResolvingCloudAnchors(): Promise<void>;
};
