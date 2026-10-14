import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProductDto } from '@airoom/shared';
import { absoluteUrl } from './asset-urls';
import { buildApp } from './app';

const root = mkdtempSync(path.join(tmpdir(), 'airoom-static-'));
mkdirSync(path.join(root, 'models', 'chair', '_build'), { recursive: true });
writeFileSync(path.join(root, 'models', 'chair', 'model.glb'), 'glTF-binary');
writeFileSync(path.join(root, 'models', 'chair', 'notes.txt'), 'not an asset type');
writeFileSync(path.join(root, 'models', 'chair', '_build', 'preview.png'), 'build leftover');
writeFileSync(path.join(root, 'secret.json'), '{}');

const app = buildApp({ staticRoot: root });
beforeAll(() => app.ready());
afterAll(() => app.close());

describe('GET /static/*', () => {
  it('serves known asset types with a content type', async () => {
    const res = await app.inject({ method: 'GET', url: '/static/models/chair/model.glb' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('model/gltf-binary');
    expect(res.body).toBe('glTF-binary');
  });

  it.each([
    ['missing file', '/static/models/chair/nope.glb'],
    ['unknown type', '/static/models/chair/notes.txt'],
    ['build folder', '/static/models/chair/_build/preview.png'],
    ['parent traversal', '/static/models/%2e%2e/%2e%2e/secret.json'],
    ['encoded slash', '/static/models%2f..%2f..%2fsecret.json'],
    ['directory', '/static/models/chair'],
  ])('404 for %s', async (_name, url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(404);
  });
});

describe('asset URLs', () => {
  it('makes relative URLs absolute and leaves absolute ones', () => {
    expect(absoluteUrl('/static/a.glb', 'http://10.0.0.2:3333')).toBe('http://10.0.0.2:3333/static/a.glb');
    expect(absoluteUrl('https://cdn.example.com/a.glb', 'http://x')).toBe('https://cdn.example.com/a.glb');
  });

  it('resolves seed /static URLs against the host the client used', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/products/prod-chair-sol',
      headers: { host: '192.168.1.66:3333' },
    });
    const product = res.json<ProductDto>();
    expect(product.model.glbUrl).toBe('http://192.168.1.66:3333/static/models/swivel-tub-armchair/model.glb');
    expect(product.thumbnailUrl).toBe('http://192.168.1.66:3333/static/models/swivel-tub-armchair/thumbnail.jpg');
  });
});

describe('real static folder', () => {
  const real = buildApp();
  beforeAll(() => real.ready());
  afterAll(() => real.close());

  it('versions /static model URLs so regenerated models bust the device cache', async () => {
    const res = await real.inject({ method: 'GET', url: '/products/prod-chair-sol', headers: { host: 'localhost:3333' } });
    const { model } = res.json<ProductDto>();
    expect(model.glbUrl).toMatch(/^http:\/\/localhost:3333\/static\/models\/swivel-tub-armchair\/model\.glb\?v=[0-9a-z]+$/);
    const file = await real.inject({ method: 'GET', url: new URL(model.glbUrl).pathname + new URL(model.glbUrl).search });
    expect(file.statusCode).toBe(200);
  });

  it('serves the Blender-built chair under 5 MB', async () => {
    const res = await real.inject({ method: 'GET', url: '/static/models/swivel-tub-armchair/model.glb' });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('glTF');
    expect(res.rawPayload.length).toBeLessThanOrEqual(5 * 1024 * 1024);
  });
});
