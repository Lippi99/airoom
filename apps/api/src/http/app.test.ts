import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProductDto } from '@airoom/shared';
import { buildApp } from './app';

const app = buildApp();

beforeAll(() => app.ready());
afterAll(() => app.close());

describe('HTTP API (seeded in-memory data)', () => {
  it('GET /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /categories', async () => {
    const res = await app.inject({ method: 'GET', url: '/categories' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toContainEqual({ id: 'cat-rug', slug: 'rug', name: 'Rugs' });
  });

  it('GET /products lists only active products with embedded category', async () => {
    const res = await app.inject({ method: 'GET', url: '/products' });
    const products = res.json<ProductDto[]>();
    expect(res.statusCode).toBe(200);
    expect(products.map((p) => p.id)).not.toContain('prod-storage-kai');
    expect(products[0]?.category).toHaveProperty('slug');
    expect(products[0]).not.toHaveProperty('productUrl');
  });

  it('GET /products?category=rug&search=wool', async () => {
    const res = await app.inject({ method: 'GET', url: '/products?category=rug&search=wool' });
    expect(res.json<ProductDto[]>().map((p) => p.id)).toEqual(['prod-rug-dune']);
  });

  it('GET /products with an unknown category returns 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/products?category=spaceship' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('GET /products/:id returns details or 404', async () => {
    const ok = await app.inject({ method: 'GET', url: '/products/prod-sofa-oslo' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<ProductDto>().model.glbUrl).toMatch(/\.glb$/);

    const missing = await app.inject({ method: 'GET', url: '/products/nope' });
    expect(missing.statusCode).toBe(404);
    const inactive = await app.inject({ method: 'GET', url: '/products/prod-storage-kai' });
    expect(inactive.statusCode).toBe(404);
  });

  it('GET /go/:productId redirects with 302 to the affiliate URL', async () => {
    const res = await app.inject({ method: 'GET', url: '/go/prod-sofa-oslo?platform=android' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://northwood.example.com/products/sofa-oslo?ref=airoom');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('GET /go/:productId never blocks on invalid tracking params', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/go/prod-chair-mira?platform=windows&sessionId=${'x'.repeat(500)}`,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://casa-atelier.example.com/products/chair-mira');
  });

  it('GET /go/:productId returns 404 for unknown products', async () => {
    const res = await app.inject({ method: 'GET', url: '/go/nope' });
    expect(res.statusCode).toBe(404);
  });
});
