import { blockedMessage, canPlace, errorCodeOf, errorMessage, getGuidance, surfaceFor, type GuidanceInput } from './guidance';

const ready: GuidanceInput = { surface: 'floor', tracking: 'normal', floorCount: 1, wallCount: 0, itemCount: 0, isPlacing: false };
const readyWall: GuidanceInput = { ...ready, surface: 'wall', floorCount: 0, wallCount: 1 };

describe('getGuidance', () => {
  it.each<[Partial<GuidanceInput>, RegExp]>([
    [{ tracking: null }, /Starting/],
    [{ tracking: 'notAvailable' }, /Tracking lost/],
    [{ tracking: 'limited' }, /scan the room/],
    [{ floorCount: 0 }, /floor and move/],
    [{}, /tap Place/],
    [{ isPlacing: true }, /Loading/],
    [{ itemCount: 2 }, /tap Place/],
  ])('%o -> %s', (override, expected) => {
    expect(getGuidance({ ...ready, ...override })).toMatch(expected);
  });

  it.each<[Partial<GuidanceInput>, RegExp]>([
    [{ itemCount: 0 }, /Tap Add/],
    [{ itemCount: 2 }, /Tap an item/],
    [{ itemCount: 2, selectedSurface: 'floor' }, /Twist to rotate · Double-tap to delete/],
    [{ itemCount: 2, selectedSurface: 'wall' }, /^Arrows or drag to move it · Double-tap/],
  ])('arranging (nothing to place) %o -> %s', (override, expected) => {
    expect(getGuidance({ ...ready, surface: null, ...override })).toMatch(expected);
  });
});

describe('wall art', () => {
  it('goes on a wall', () => {
    expect(surfaceFor('wall-art')).toBe('wall');
    expect(surfaceFor('sofa')).toBe('floor');
  });

  it.each<[Partial<GuidanceInput>, RegExp]>([
    [{ wallCount: 0 }, /1-2 m from the wall/],
    [{}, /should hang/],
    [{ itemCount: 1 }, /should hang/],
    [{ tracking: 'limited' }, /scan the room/],
  ])('guidance %o -> %s', (override, expected) => {
    expect(getGuidance({ ...readyWall, ...override })).toMatch(expected);
  });

  it('does not wait for a detected wall plane (plain walls are measured on Place)', () => {
    expect(canPlace(readyWall)).toBe(true);
    expect(canPlace({ ...readyWall, wallCount: 0, floorCount: 0 })).toBe(true);
    expect(canPlace({ ...readyWall, tracking: 'limited' })).toBe(false);
    expect(canPlace({ ...readyWall, isPlacing: true })).toBe(false);
  });

  it('explains wall placement problems', () => {
    expect(blockedMessage('noWall')).toMatch(/on the wall/);
    expect(errorMessage({ code: 'NO_WALL', message: '' }, 'wall')).toMatch(/at a wall/);
    expect(errorMessage({ code: 'PLACEMENT_BLOCKED', message: '' }, 'wall')).toMatch(/free area of the wall/);
  });
});

describe('canPlace', () => {
  it('needs normal tracking, a floor and no placement in progress', () => {
    expect(canPlace(ready)).toBe(true);
    expect(canPlace({ ...ready, tracking: 'limited' })).toBe(false);
    expect(canPlace({ ...ready, floorCount: 0 })).toBe(false);
    expect(canPlace({ ...ready, isPlacing: true })).toBe(false);
  });

  it('needs something to place', () => {
    expect(canPlace({ ...ready, surface: null })).toBe(false);
  });
});

describe('messages', () => {
  it('explains blocked moves', () => {
    expect(blockedMessage('noFloor')).toMatch(/floor/);
    expect(blockedMessage('wall')).toMatch(/wall/);
    expect(blockedMessage('item')).toMatch(/overlap/);
  });

  it('maps known error codes and falls back to the native message', () => {
    expect(errorMessage({ code: 'MODEL_LOAD_FAILED', message: 'x' })).toMatch(/download/);
    expect(errorMessage({ code: 'PLACEMENT_BLOCKED', message: 'x' })).toMatch(/free area/);
    expect(errorMessage({ code: 'SOMETHING_NEW', message: 'Native says hi' })).toBe('Native says hi');
    expect(errorMessage({ code: 'CLOUD_ANCHOR_LOW_QUALITY', message: '' })).toMatch(/walk a few steps/);
    expect(errorMessage({ code: 'CLOUD_ANCHOR_NOT_AUTHORIZED', message: '' })).toMatch(/not set up/);
  });

  it('reads codes from rejected native promises', () => {
    expect(errorCodeOf({ code: 'NO_FLOOR' })).toBe('NO_FLOOR');
    expect(errorCodeOf({ code: 'ERR_NOT_READY' })).toBe('NOT_READY');
    expect(errorCodeOf(new Error('plain'))).toBe('UNKNOWN');
  });
});
