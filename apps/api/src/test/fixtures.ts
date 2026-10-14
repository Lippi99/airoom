import type { Category, Product, Retailer } from '../domain/entities';

export const categoriesFixture: Category[] = [
  { id: 'c-sofa', slug: 'sofa', name: 'Sofas' },
  { id: 'c-rug', slug: 'rug', name: 'Rugs' },
  { id: 'c-lamp', slug: 'lamp', name: 'Lamps' },
];

export const retailersFixture: Retailer[] = [
  { id: 'r-1', name: 'Retailer One', websiteUrl: 'https://one.example.com' },
  { id: 'r-2', name: 'Retailer Two', websiteUrl: 'https://two.example.com' },
];

export function makeProduct(overrides: Partial<Product> & Pick<Product, 'id'>): Product {
  return {
    name: `Product ${overrides.id}`,
    description: 'A test product',
    categoryId: 'c-sofa',
    retailerId: 'r-1',
    price: 100,
    currency: 'USD',
    dimensions: { width: 2, depth: 0.9, height: 0.8 },
    thumbnailUrl: 'https://img.example.com/t.png',
    model: {
      glbUrl: 'https://cdn.example.com/m.glb',
      usdzUrl: 'https://cdn.example.com/m.usdz',
      sizeBytes: 1000,
    },
    productUrl: `https://one.example.com/p/${overrides.id}`,
    active: true,
    ...overrides,
  };
}

export const productsFixture: Product[] = [
  makeProduct({ id: 'p-sofa', name: 'Oslo Sofa', description: 'Linen sofa' }),
  makeProduct({
    id: 'p-rug',
    name: 'Dune Rug',
    description: 'Wool rug',
    categoryId: 'c-rug',
    retailerId: 'r-2',
    affiliateUrl: 'https://two.example.com/p/p-rug?ref=airoom',
  }),
  makeProduct({ id: 'p-inactive', name: 'Old Sofa', active: false }),
];

export const silentLogger = { error: () => {} };
