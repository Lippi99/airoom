import { describe, expect, it } from 'vitest';
import { InMemoryCategoryRepository } from '../repositories/in-memory/in-memory-category-repository';
import { InMemoryProductRepository } from '../repositories/in-memory/in-memory-product-repository';
import { InMemoryRetailerRepository } from '../repositories/in-memory/in-memory-retailer-repository';
import { categoriesFixture, makeProduct, productsFixture, retailersFixture } from '../test/fixtures';
import { CategoryService } from './category-service';
import { ProductDtoMapper } from './product-dto-mapper';
import { ProductService } from './product-service';

function setup(products = productsFixture) {
  const categories = new InMemoryCategoryRepository(categoriesFixture);
  const retailers = new InMemoryRetailerRepository(retailersFixture);
  const mapper = new ProductDtoMapper(categories, retailers);
  return new ProductService(new InMemoryProductRepository(products), categories, mapper);
}

describe('ProductService.list', () => {
  it('returns only active products', async () => {
    const ids = (await setup().list()).map((p) => p.id);
    expect(ids).toEqual(['p-sofa', 'p-rug']);
  });

  it('filters by category slug', async () => {
    expect((await setup().list({ category: 'rug' })).map((p) => p.id)).toEqual(['p-rug']);
  });

  it('returns an empty list for a valid slug with no category in the catalog', async () => {
    expect(await setup().list({ category: 'bed' })).toEqual([]);
  });

  it('filters by search text and ignores blank search', async () => {
    expect((await setup().list({ search: 'wool' })).map((p) => p.id)).toEqual(['p-rug']);
    expect(await setup().list({ search: '   ' })).toHaveLength(2);
  });

  it('embeds category and retailer and hides retailer URLs', async () => {
    const [rug] = await setup().list({ category: 'rug' });
    expect(rug).toMatchObject({
      category: { id: 'c-rug', slug: 'rug', name: 'Rugs' },
      retailer: { id: 'r-2', name: 'Retailer Two' },
    });
    expect(rug).not.toHaveProperty('productUrl');
    expect(rug).not.toHaveProperty('affiliateUrl');
    expect(rug).not.toHaveProperty('categoryId');
  });
});

describe('ProductService.getById', () => {
  it('returns the product DTO', async () => {
    const product = await setup().getById('p-sofa');
    expect(product?.category.slug).toBe('sofa');
    expect(product?.dimensions).toEqual({ width: 2, depth: 0.9, height: 0.8 });
  });

  it('returns null for unknown or inactive products', async () => {
    expect(await setup().getById('nope')).toBeNull();
    expect(await setup().getById('p-inactive')).toBeNull();
  });

  it('fails loudly on a broken category reference', async () => {
    const service = setup([makeProduct({ id: 'p-bad', categoryId: 'c-missing' })]);
    await expect(service.getById('p-bad')).rejects.toThrow(/unknown category/);
  });
});

describe('CategoryService.list', () => {
  it('returns category DTOs', async () => {
    const service = new CategoryService(new InMemoryCategoryRepository(categoriesFixture));
    expect(await service.list()).toEqual(categoriesFixture);
  });
});
