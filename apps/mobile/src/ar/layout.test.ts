import type { ARPlacedItem, ARPose } from '../../modules/furniture-ar';
import { fitReference, referenceFromItem, referenceIndex, toSceneItems, toScenePose, toWorldPose, wrapAngle } from './layout';

const close = (a: ARPose, b: ARPose) => {
  expect(a.x).toBeCloseTo(b.x, 4);
  expect(a.y).toBeCloseTo(b.y, 4);
  expect(a.z).toBeCloseTo(b.z, 4);
  expect(wrapAngle(a.yaw - b.yaw)).toBeCloseTo(0, 4);
};

describe('scene layout', () => {
  it('wraps angles into (-π, π]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(0.5)).toBeCloseTo(0.5);
  });

  it('expresses a pose in the reference frame: right = +X, front = +Z', () => {
    // Reference turned 90° (its front is world +X): an item 1 m in front of it is world +X.
    const ref = { x: 2, y: 0, z: 3, yaw: Math.PI / 2 };
    const p = toScenePose(ref, { x: 3, y: 0, z: 3, yaw: Math.PI / 2 });
    expect(p.x).toBeCloseTo(0);
    expect(p.z).toBeCloseTo(1);
    expect(p.yaw).toBeCloseTo(0);
    // Its right (world -Z here) is +X.
    expect(toScenePose(ref, { x: 2, y: 0, z: 2, yaw: 0 }).x).toBeCloseTo(1);
  });

  it('round-trips through a moved and turned reference', () => {
    const saved = { x: 0, y: 0, z: 0, yaw: 0.3 };
    const item = { x: 1.4, y: 1.5, z: -0.7, yaw: -2.9 };
    const relative = toScenePose(saved, item);
    // Same relative pose around the reference's original spot gives the item back.
    close(toWorldPose(saved, relative), item);
    // Around a new spot, distances to the reference are kept.
    const moved = { x: -3, y: 0.1, z: 5, yaw: 2.2 };
    const again = toWorldPose(moved, relative);
    expect(Math.hypot(again.x - moved.x, again.z - moved.z)).toBeCloseTo(Math.hypot(item.x - saved.x, item.z - saved.z), 4);
    expect(again.y - moved.y).toBeCloseTo(item.y - saved.y, 4);
    close(toWorldPose(moved, toScenePose(moved, again)), again);
  });

  it('recovers the reference from any placed item', () => {
    const reference = { x: 1, y: 0, z: -2, yaw: 1.1 };
    const pose = { x: 0.8, y: 1.4, z: -0.3, yaw: 0.4 };
    close(referenceFromItem(toWorldPose(reference, pose), pose), reference);
  });

  it('fits the reference from several found items, better than one noisy item', () => {
    const reference = { x: 2, y: 0.01, z: -1, yaw: 0.8 };
    const saved = [
      { x: 0, y: 0, z: 0, yaw: 0 },
      { x: 1.3, y: 0, z: 0.1, yaw: -1.6 },
      { x: 0.4, y: 1.45, z: -0.9, yaw: 0 },
    ];
    // Each found anchor is a little off (2 cm, and the first one 2° turned).
    const noise = [
      { x: 0.02, z: 0, yaw: 0.035 },
      { x: -0.01, z: 0.02, yaw: 0 },
      { x: 0, z: -0.02, yaw: 0 },
    ];
    const matches = saved.map((pose, i) => {
      const w = toWorldPose(reference, pose);
      return { world: { ...w, x: w.x + noise[i]!.x, z: w.z + noise[i]!.z, yaw: w.yaw + noise[i]!.yaw }, saved: pose };
    });
    const fit = fitReference(matches)!;
    const single = referenceFromItem(matches[0]!.world, matches[0]!.saved);
    // The far painting, placed from the fit vs. from the first item alone.
    const truth = toWorldPose(reference, saved[2]!);
    const errorOf = (ref: { x: number; y: number; z: number; yaw: number }) => {
      const p = toWorldPose(ref, saved[2]!);
      return Math.hypot(p.x - truth.x, p.z - truth.z);
    };
    expect(errorOf(fit)).toBeLessThan(0.025);
    expect(errorOf(fit)).toBeLessThan(errorOf(single));
    expect(fit.y).toBeCloseTo(0.01, 4);
  });

  it('fits exactly without noise, and averages yaws when found items are bunched', () => {
    const reference = { x: -1, y: 0, z: 3, yaw: -2.5 };
    const saved = [
      { x: 0, y: 0, z: 0, yaw: 0 },
      { x: 2, y: 0, z: 1, yaw: 1 },
    ];
    close(fitReference(saved.map((pose) => ({ world: toWorldPose(reference, pose), saved: pose })))!, reference);
    const bunched = [
      { x: 0, y: 0, z: 0, yaw: 0 },
      { x: 0.1, y: 0, z: 0, yaw: 0.3 },
    ];
    close(fitReference(bunched.map((pose) => ({ world: toWorldPose(reference, pose), saved: pose })))!, reference);
    expect(fitReference([])).toBeNull();
  });

  it('anchors on the first floor item, else the first item', () => {
    const isWall = (id: string) => id.startsWith('art');
    expect(referenceIndex([{ productId: 'art-1' }, { productId: 'chair' }], isWall)).toBe(1);
    expect(referenceIndex([{ productId: 'art-1' }, { productId: 'art-2' }], isWall)).toBe(0);
    expect(referenceIndex([], isWall)).toBe(-1);
  });

  it('builds scene items with the reference first at the origin', () => {
    const placed: ARPlacedItem[] = [
      { instanceId: 'a', productId: 'art-1', pose: { x: 0, y: 1.5, z: -2, yaw: 0 } },
      { instanceId: 'c', productId: 'chair', pose: { x: 0, y: 0, z: -1, yaw: Math.PI } },
    ];
    const items = toSceneItems(placed, (id) => id.startsWith('art'));
    expect(items.map((i) => i.productId)).toEqual(['chair', 'art-1']);
    expect(items[0]!.pose).toEqual({ x: 0, y: 0, z: 0, yaw: 0 });
    // The chair faces -Z (yaw π): the painting 1 m further along -Z is 1 m in front of it.
    expect(items[1]!.pose.z).toBeCloseTo(1);
    expect(items[1]!.pose.y).toBeCloseTo(1.5);
    expect(toSceneItems([], () => false)).toEqual([]);
    // Each item keeps its own cloud anchor.
    const anchor = { cloudAnchorId: 'ua-1', expiresAt: '2027-01-01T00:00:00.000Z' };
    const withAnchors = toSceneItems(placed, (id) => id.startsWith('art'), new Map([['a', anchor]]));
    expect(withAnchors[1]).toMatchObject({ productId: 'art-1', anchor });
    expect(withAnchors[0]).not.toHaveProperty('anchor');
  });
});
