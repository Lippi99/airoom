import { describe, expect, it } from 'vitest';
import { categoriesFixture, productsFixture, retailersFixture } from '../../test/fixtures';
import { InMemoryCategoryRepository } from './in-memory-category-repository';
import { InMemoryClickEventRepository } from './in-memory-click-event-repository';
import { InMemoryProductRepository } from './in-memory-product-repository';
import { InMemoryRetailerRepository } from './in-memory-retailer-repository';
import { InMemorySceneRepository } from './in-memory-scene-repository';

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

describe('InMemorySceneRepository', () => {
  const scene = (id: string, updatedAt: string) => ({
    id,
    name: `Scene ${id}`,
    items: [{ productId: 'p-sofa', pose: { x: 0, y: 0, z: 0, yaw: 0 } }],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date(updatedAt),
  });

  it('saves (upserts), lists newest first, finds and deletes', async () => {
    const repo = new InMemorySceneRepository();
    await repo.save(scene('a', '2026-01-02T00:00:00Z'));
    await repo.save(scene('b', '2026-01-03T00:00:00Z'));
    await repo.save({ ...scene('a', '2026-01-04T00:00:00Z'), name: 'Renamed' });
    expect((await repo.findAll()).map((s) => s.name)).toEqual(['Renamed', 'Scene b']);
    expect((await repo.findById('b'))?.name).toBe('Scene b');
    expect(await repo.findById('x')).toBeNull();
    expect(await repo.delete('a')).toBe(true);
    expect(await repo.delete('a')).toBe(false);
    expect(await repo.findAll()).toHaveLength(1);
  });

  it('returns copies so callers cannot mutate stored data', async () => {
    const repo = new InMemorySceneRepository();
    await repo.save(scene('a', '2026-01-02T00:00:00Z'));
    const found = await repo.findById('a');
    found!.items[0]!.pose.x = 9;
    expect((await repo.findById('a'))?.items[0]?.pose.x).toBe(0);
  });
});
