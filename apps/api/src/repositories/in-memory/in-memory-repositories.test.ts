import { describe, expect, it } from 'vitest';
import { categoriesFixture, productsFixture, retailersFixture } from '../../test/fixtures';
import { InMemoryCategoryRepository } from './in-memory-category-repository';
import { InMemoryClickEventRepository } from './in-memory-click-event-repository';
import { InMemoryProductRepository } from './in-memory-product-repository';
import { InMemoryRetailerRepository } from './in-memory-retailer-repository';

describe('InMemoryProductRepository', () => {
  const repo = () => new InMemoryProductRepository(productsFixture);

  it('returns all products without a filter', async () => {
    expect(await repo().findAll()).toHaveLength(3);
  });

  it('filters by category, active flag and case-insensitive search', async () => {
    const r = repo();
    expect((await r.findAll({ categoryId: 'c-rug' })).map((p) => p.id)).toEqual(['p-rug']);
    expect((await r.findAll({ active: false })).map((p) => p.id)).toEqual(['p-inactive']);
    expect((await r.findAll({ search: 'LINEN' })).map((p) => p.id)).toEqual(['p-sofa']);
    expect((await r.findAll({ search: 'sofa', active: true })).map((p) => p.id)).toEqual(['p-sofa']);
  });

  it('finds by id or returns null', async () => {
    expect((await repo().findById('p-rug'))?.name).toBe('Dune Rug');
    expect(await repo().findById('nope')).toBeNull();
  });

  it('returns copies so callers cannot mutate stored data', async () => {
    const r = repo();
    const product = await r.findById('p-sofa');
    product!.dimensions.width = 99;
    expect((await r.findById('p-sofa'))!.dimensions.width).toBe(2);
  });
});

describe('InMemoryCategoryRepository', () => {
  it('lists and finds by slug', async () => {
    const repo = new InMemoryCategoryRepository(categoriesFixture);
    expect(await repo.findAll()).toHaveLength(3);
    expect((await repo.findBySlug('rug'))?.id).toBe('c-rug');
    expect(await repo.findBySlug('bed')).toBeNull();
  });
});

describe('InMemoryRetailerRepository', () => {
  it('finds by id or returns null', async () => {
    const repo = new InMemoryRetailerRepository(retailersFixture);
    expect((await repo.findById('r-2'))?.name).toBe('Retailer Two');
    expect(await repo.findById('r-x')).toBeNull();
  });
});

describe('InMemoryClickEventRepository', () => {
  it('saves events and counts them per product', async () => {
    const repo = new InMemoryClickEventRepository();
    const base = { timestamp: new Date(), platform: 'ios' as const };
    await repo.save({ id: '1', productId: 'a', ...base });
    await repo.save({ id: '2', productId: 'a', ...base });
    await repo.save({ id: '3', productId: 'b', ...base });
    expect(await repo.countByProduct('a')).toBe(2);
    expect(await repo.countByProduct('b')).toBe(1);
    expect(await repo.countByProduct('c')).toBe(0);
  });
});
