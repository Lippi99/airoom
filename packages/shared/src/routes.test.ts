import { describe, expect, it } from 'vitest';
import { buildGoUrl } from './routes';
import { isFloorCovering, isFurnitureCategory, isWallMounted, FurnitureCategory } from './categories';
import { isClickPlatform } from './clicks';

describe('buildGoUrl', () => {
  it('builds the link without query params', () => {
    expect(buildGoUrl('http://api.test', 'p1')).toBe('http://api.test/go/p1');
  });

  it('adds platform and sessionId and trims trailing slashes', () => {
    expect(buildGoUrl('http://api.test/', 'p1', { platform: 'android', sessionId: 's 1' })).toBe(
      'http://api.test/go/p1?platform=android&sessionId=s+1',
    );
  });

  it('encodes the product id', () => {
    expect(buildGoUrl('http://api.test', 'a/b')).toBe('http://api.test/go/a%2Fb');
  });
});

describe('guards', () => {
  it('recognizes furniture categories', () => {
    expect(isFurnitureCategory('sofa')).toBe(true);
    expect(isFurnitureCategory('spaceship')).toBe(false);
    expect(isFurnitureCategory(undefined)).toBe(false);
  });

  it('treats only rugs as floor coverings', () => {
    expect(isFloorCovering(FurnitureCategory.Rug)).toBe(true);
    expect(isFloorCovering(FurnitureCategory.Sofa)).toBe(false);
  });

  it('treats only wall art as wall-mounted', () => {
    expect(isFurnitureCategory('wall-art')).toBe(true);
    expect(isWallMounted(FurnitureCategory.WallArt)).toBe(true);
    expect(isWallMounted(FurnitureCategory.Storage)).toBe(false);
  });

  it('recognizes click platforms', () => {
    expect(isClickPlatform('ios')).toBe(true);
    expect(isClickPlatform('windows')).toBe(false);
  });
});
