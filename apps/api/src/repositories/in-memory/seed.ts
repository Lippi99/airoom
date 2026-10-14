import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { FURNITURE_CATEGORIES } from '@airoom/shared';
import type { Category, Product, Retailer } from '../../domain/entities';

const meters = z.number().positive();

/** Absolute URL (CDN) or a development asset served by this API under /static/. */
const assetUrl = z.union([z.url(), z.string().regex(/^\/static\/[\w\-./]+$/)]);

const categorySchema = z.object({
  id: z.string().min(1),
  slug: z.enum(FURNITURE_CATEGORIES),
  name: z.string().min(1),
});

const retailerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  websiteUrl: z.url(),
  affiliateProgram: z.string().optional(),
});

const productSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  categoryId: z.string().min(1),
  retailerId: z.string().min(1),
  price: z.number().nonnegative(),
  currency: z.string().length(3),
  dimensions: z.object({ width: meters, depth: meters, height: meters }),
  thumbnailUrl: assetUrl,
  model: z.object({
    glbUrl: assetUrl,
    usdzUrl: assetUrl,
    sizeBytes: z.number().int().positive(),
  }),
  productUrl: z.url(),
  affiliateUrl: z.url().optional(),
  active: z.boolean(),
});

export interface SeedData {
  categories: Category[];
  retailers: Retailer[];
  products: Product[];
}

const seedDir = new URL('../../data/seed/', import.meta.url);

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(new URL(file, seedDir), 'utf8'));
}

/**
 * Loads and validates the JSON seed. Fails fast on invalid data or broken references,
 * so a bad seed never reaches the running API.
 */
export function loadSeed(): SeedData {
  const categories = z.array(categorySchema).parse(readJson('categories.json'));
  const retailers = z.array(retailerSchema).parse(readJson('retailers.json'));
  const products = z.array(productSchema).parse(readJson('products.json'));
  assertSeedIntegrity({ categories, retailers, products });
  return { categories, retailers, products };
}

export function assertSeedIntegrity({ categories, retailers, products }: SeedData): void {
  const categoryIds = new Set(categories.map((c) => c.id));
  const retailerIds = new Set(retailers.map((r) => r.id));
  const productIds = new Set<string>();
  for (const p of products) {
    if (productIds.has(p.id)) throw new Error(`Seed: duplicate product id "${p.id}"`);
    productIds.add(p.id);
    if (!categoryIds.has(p.categoryId)) {
      throw new Error(`Seed: product "${p.id}" references unknown category "${p.categoryId}"`);
    }
    if (!retailerIds.has(p.retailerId)) {
      throw new Error(`Seed: product "${p.id}" references unknown retailer "${p.retailerId}"`);
    }
  }
}
