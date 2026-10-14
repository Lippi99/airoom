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
    [{ itemCount: 2 }, /Drag to move/],
  ])('%o -> %s', (override, expected) => {
    expect(getGuidance({ ...ready, ...override })).toMatch(expected);
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
    [{ itemCount: 1 }, /along the wall/],
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
  });

  it('reads codes from rejected native promises', () => {
    expect(errorCodeOf({ code: 'NO_FLOOR' })).toBe('NO_FLOOR');
    expect(errorCodeOf({ code: 'ERR_NOT_READY' })).toBe('NOT_READY');
    expect(errorCodeOf(new Error('plain'))).toBe('UNKNOWN');
  });
});
