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
};

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
  | 'SNAPSHOT_FAILED';

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
  onError?: (e: NativeEvent<ARErrorEvent>) => void;
};

/** Imperative methods, called through a ref. */
export type FurnitureARViewRef = {
  /**
   * Places the item where the screen-center ray hits the floor; rejects with `NO_FLOOR` if
   * it misses. Wall-mounted items (`wall-art`) hang where the ray hits a wall instead (the
   * hit point becomes the item's center, its back flat on the wall); rejects with `NO_WALL`.
   */
  placeItem(item: ARItem): Promise<void>;
  removeItem(instanceId: string): Promise<void>;
  clearScene(): Promise<void>;
  /** Photo of the AR scene (camera + furniture). `uri` is a local file URI. */
  captureSnapshot(): Promise<{ uri: string }>;
};
