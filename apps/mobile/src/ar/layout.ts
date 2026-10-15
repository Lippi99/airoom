import type { SceneAnchor, SceneItemDto, ScenePose } from '@airoom/shared';
import type { ARPlacedItem, ARPose } from '../../modules/furniture-ar';

/**
 * Converts between AR world poses (valid only in one AR session) and a saved scene's poses,
 * which are relative to the scene's reference item (see `ScenePose` in packages/shared).
 */

/** Wraps an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  const twoPi = 2 * Math.PI;
  let r = a % twoPi;
  if (r > Math.PI) r -= twoPi;
  if (r <= -Math.PI) r += twoPi;
  return r;
}

/** Pose of `pose` in the frame of `reference` (its right = +X, up = +Y, front = +Z). */
export function toScenePose(reference: ARPose, pose: ARPose): ScenePose {
  const dx = pose.x - reference.x;
  const dz = pose.z - reference.z;
  const c = Math.cos(reference.yaw);
  const s = Math.sin(reference.yaw);
  return { x: c * dx - s * dz, y: pose.y - reference.y, z: s * dx + c * dz, yaw: wrapAngle(pose.yaw - reference.yaw) };
}

/** World pose of a scene pose, given where its reference item is now. Inverse of `toScenePose`. */
export function toWorldPose(reference: ARPose, pose: ScenePose): ARPose {
  const c = Math.cos(reference.yaw);
  const s = Math.sin(reference.yaw);
  return {
    x: reference.x + c * pose.x + s * pose.z,
    y: reference.y + pose.y,
    z: reference.z - s * pose.x + c * pose.z,
    yaw: wrapAngle(reference.yaw + pose.yaw),
  };
}

/**
 * Where the scene's reference is, given where one of its items ended up (`world`) and that
 * item's saved pose. Lets a scene be rebuilt from whichever item the user aims, even if the
 * reference product is no longer in the catalog.
 */
export function referenceFromItem(world: ARPose, pose: ScenePose): ARPose {
  const yaw = wrapAngle(world.yaw - pose.yaw);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    x: world.x - (c * pose.x + s * pose.z),
    y: world.y - pose.y,
    z: world.z - (-s * pose.x + c * pose.z),
    yaw,
  };
}

/** A saved item's pose, and where its cloud anchor put it in this session. */
export interface AnchorMatch {
  world: ARPose;
  saved: ScenePose;
}

/** Below this RMS distance from their center, found items can't fix the scene's angle well. */
const MIN_FIT_SPREAD_M = 0.25;

/**
 * Where the scene's reference is in this session, from the items whose cloud anchors were
 * found. One match gives it directly (`referenceFromItem`). With several, a least-squares rigid
 * fit of their positions seen from above: better than any single one, whose small angle error
 * grows with distance. Height: their average offset. Matches bunched closer than
 * `MIN_FIT_SPREAD_M` can't fix the angle, so the items' own yaws are averaged instead.
 */
export function fitReference(matches: AnchorMatch[]): ARPose | null {
  const n = matches.length;
  if (n === 0) return null;
  if (n === 1) return referenceFromItem(matches[0]!.world, matches[0]!.saved);
  const mean = (f: (m: AnchorMatch) => number) => matches.reduce((sum, m) => sum + f(m), 0) / n;
  const sx = mean((m) => m.saved.x);
  const sz = mean((m) => m.saved.z);
  const wx = mean((m) => m.world.x);
  const wz = mean((m) => m.world.z);
  let dot = 0;
  let cross = 0;
  let spread = 0;
  let sin = 0;
  let cos = 0;
  for (const m of matches) {
    const ax = m.saved.x - sx;
    const az = m.saved.z - sz;
    const bx = m.world.x - wx;
    const bz = m.world.z - wz;
    // world = reference + R(yaw)·saved, with R·(x, z) = (c·x + s·z, −s·x + c·z).
    dot += ax * bx + az * bz;
    cross += az * bx - ax * bz;
    spread += ax * ax + az * az;
    const turn = m.world.yaw - m.saved.yaw;
    sin += Math.sin(turn);
    cos += Math.cos(turn);
  }
  const yaw = spread / n >= MIN_FIT_SPREAD_M * MIN_FIT_SPREAD_M ? Math.atan2(cross, dot) : Math.atan2(sin, cos);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    x: wx - (c * sx + s * sz),
    y: mean((m) => m.world.y - m.saved.y),
    z: wz - (-s * sx + c * sz),
    yaw: wrapAngle(yaw),
  };
}

/**
 * Index of the item a scene is anchored on: the first floor item (the floor is the same
 * wherever the user aims, walls are not), else the first item. -1 for an empty list.
 */
export function referenceIndex<T extends { productId: string }>(items: T[], isWallItem: (productId: string) => boolean): number {
  if (items.length === 0) return -1;
  const floor = items.findIndex((i) => !isWallItem(i.productId));
  return floor === -1 ? 0 : floor;
}

/** 0.1 mm / 0.0001 rad; `|| 0` turns -0 into 0. */
const round = (v: number) => Math.round(v * 10_000) / 10_000 || 0;

/**
 * Scene items to save from the items in the AR view (placement order): the reference first
 * with the identity pose, then the others relative to it; each with its cloud anchor from
 * `anchors` (by instance id), if any.
 */
export function toSceneItems(
  placed: ARPlacedItem[],
  isWallItem: (productId: string) => boolean,
  anchors: ReadonlyMap<string, SceneAnchor> = new Map(),
): SceneItemDto[] {
  const ref = referenceIndex(placed, isWallItem);
  if (ref === -1) return [];
  const reference = placed[ref]!;
  const ordered = [reference, ...placed.filter((_, i) => i !== ref)];
  return ordered.map((item) => {
    const p = toScenePose(reference.pose, item.pose);
    const anchor = anchors.get(item.instanceId);
    return {
      productId: item.productId,
      pose: { x: round(p.x), y: round(p.y), z: round(p.z), yaw: round(p.yaw) },
      ...(anchor ? { anchor } : {}),
    };
  });
}
