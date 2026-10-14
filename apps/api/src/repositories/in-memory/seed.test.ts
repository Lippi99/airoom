import { describe, expect, it } from 'vitest';
import { isFurnitureCategory } from '@airoom/shared';
import { categoriesFixture, makeProduct, retailersFixture } from '../../test/fixtures';
import { assertSeedIntegrity, loadSeed } from './seed';

describe('loadSeed', () => {
  it('loads the bundled JSON seed with valid references', () => {
    const seed = loadSeed();
    expect(seed.products.length).toBeGreaterThan(0);
    expect(seed.categories.every((c) => isFurnitureCategory(c.slug))).toBe(true);
  });

  it('only contains models within the 5 MB budget', () => {
    for (const p of loadSeed().products) {
      expect(p.model.sizeBytes, p.id).toBeLessThanOrEqual(5 * 1024 * 1024);
    }
  });
});

describe('assertSeedIntegrity', () => {
  const base = { categories: categoriesFixture, retailers: retailersFixture };

  it('rejects unknown category references', () => {
    expect(() =>
      assertSeedIntegrity({ ...base, products: [makeProduct({ id: 'x', categoryId: 'nope' })] }),
    ).toThrow(/unknown category/);
  });

  it('rejects unknown retailer references', () => {
    expect(() =>
      assertSeedIntegrity({ ...base, products: [makeProduct({ id: 'x', retailerId: 'nope' })] }),
    ).toThrow(/unknown retailer/);
  });

  it('rejects duplicate product ids', () => {
    expect(() =>
      assertSeedIntegrity({ ...base, products: [makeProduct({ id: 'x' }), makeProduct({ id: 'x' })] }),
    ).toThrow(/duplicate/);
  });
});
