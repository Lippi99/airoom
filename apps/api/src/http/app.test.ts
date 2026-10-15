import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProductDto, SceneDto } from '@airoom/shared';
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

describe('Scenes API', () => {
  const body = {
    name: 'Living room',
    items: [
      { productId: 'prod-chair-cora', pose: { x: 0, y: 0, z: 0, yaw: 0 } },
      { productId: 'prod-art-knights', pose: { x: 0.1, y: 1.4, z: -1.2, yaw: 0 } },
    ],
  };

  it('creates, reads, lists, updates and deletes a scene', async () => {
    const created = await app.inject({ method: 'POST', url: '/scenes', payload: body });
    expect(created.statusCode).toBe(201);
    const scene = created.json<SceneDto>();
    expect(scene).toMatchObject({ name: 'Living room', items: body.items });

    const got = await app.inject({ method: 'GET', url: `/scenes/${scene.id}` });
    expect(got.json<SceneDto>().id).toBe(scene.id);
    const list = await app.inject({ method: 'GET', url: '/scenes' });
    expect(list.json<SceneDto[]>().map((s) => s.id)).toContain(scene.id);

    const updated = await app.inject({ method: 'PUT', url: `/scenes/${scene.id}`, payload: { ...body, name: 'Den' } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<SceneDto>().name).toBe('Den');

    const deleted = await app.inject({ method: 'DELETE', url: `/scenes/${scene.id}` });
    expect(deleted.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/scenes/${scene.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/scenes/${scene.id}` })).statusCode).toBe(404);
  });

  it('validates the body', async () => {
    const blankName = await app.inject({ method: 'POST', url: '/scenes', payload: { ...body, name: '  ' } });
    expect(blankName.statusCode).toBe(400);
    expect(blankName.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
    const noItems = await app.inject({ method: 'POST', url: '/scenes', payload: { ...body, items: [] } });
    expect(noItems.statusCode).toBe(400);
    const badPose = await app.inject({
      method: 'POST',
      url: '/scenes',
      payload: { ...body, items: [{ productId: 'prod-chair-cora', pose: { x: 'a', y: 0, z: 0, yaw: 0 } }] },
    });
    expect(badPose.statusCode).toBe(400);
  });

  it('rejects products that are not in the catalog', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/scenes',
      payload: { ...body, items: [{ productId: 'prod-storage-kai', pose: { x: 0, y: 0, z: 0, yaw: 0 } }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'UNKNOWN_PRODUCT' });
  });

  it('accepts per-item anchors and validates them', async () => {
    const anchor = { cloudAnchorId: 'ua-1', expiresAt: '2027-01-01T00:00:00.000Z' };
    const withAnchor = (a: unknown) => ({ ...body, items: [{ ...body.items[0], anchor: a }, body.items[1]] });
    const ok = await app.inject({ method: 'POST', url: '/scenes', payload: withAnchor(anchor) });
    expect(ok.statusCode).toBe(201);
    expect(ok.json<SceneDto>().items[0]?.anchor).toEqual(anchor);
    const bad = await app.inject({
      method: 'POST',
      url: '/scenes',
      payload: withAnchor({ cloudAnchorId: 'ua-1', expiresAt: 'tomorrow' }),
    });
    expect(bad.statusCode).toBe(400);
  });

  it('PUT on an unknown scene returns 404', async () => {
    const res = await app.inject({ method: 'PUT', url: '/scenes/nope', payload: body });
    expect(res.statusCode).toBe(404);
  });
});
