import { describe, expect, it } from 'vitest';
import type { SaveSceneRequest } from '@airoom/shared';
import { InMemoryProductRepository } from '../repositories/in-memory/in-memory-product-repository';
import { InMemorySceneRepository } from '../repositories/in-memory/in-memory-scene-repository';
import { productsFixture } from '../test/fixtures';
import { SceneService } from './scene-service';

const origin = { x: 0, y: 0, z: 0, yaw: 0 };

function setup() {
  let clock = Date.parse('2026-10-01T10:00:00Z');
  let id = 0;
  const service = new SceneService(new InMemorySceneRepository(), new InMemoryProductRepository(productsFixture), {
    now: () => new Date((clock += 60_000)),
    newId: () => `s-${++id}`,
  });
  return service;
}

const living: SaveSceneRequest = {
  name: '  Living room  ',
  items: [
    { productId: 'p-sofa', pose: origin },
    { productId: 'p-rug', pose: { x: 0.2, y: 0, z: 1.1, yaw: 1.57 } },
  ],
};

describe('SceneService', () => {
  it('creates a scene with a trimmed name, an id and timestamps', async () => {
    const result = await setup().create(living);
    expect(result).toEqual({
      scene: {
        id: 's-1',
        name: 'Living room',
        items: living.items,
        createdAt: '2026-10-01T10:01:00.000Z',
        updatedAt: '2026-10-01T10:01:00.000Z',
      },
    });
  });

  it('rejects unknown and inactive products', async () => {
    const result = await setup().create({
      name: 'x',
      items: [
        { productId: 'p-sofa', pose: origin },
        { productId: 'nope', pose: origin },
        { productId: 'p-inactive', pose: origin },
      ],
    });
    expect(result).toEqual({ unknownProductIds: ['nope', 'p-inactive'] });
  });

  it('lists the most recently updated first and gets by id', async () => {
    const service = setup();
    await service.create({ ...living, name: 'A' });
    await service.create({ ...living, name: 'B' });
    await service.update('s-1', { ...living, name: 'A2' });
    expect((await service.list()).map((s) => s.name)).toEqual(['A2', 'B']);
    expect((await service.getById('s-2'))?.name).toBe('B');
    expect(await service.getById('missing')).toBeNull();
  });

  it('updates name and items, keeps createdAt', async () => {
    const service = setup();
    await service.create(living);
    const result = await service.update('s-1', { name: 'Den', items: [{ productId: 'p-rug', pose: origin }] });
    expect(result).toMatchObject({
      scene: { id: 's-1', name: 'Den', items: [{ productId: 'p-rug' }], createdAt: '2026-10-01T10:01:00.000Z' },
    });
    expect(result && 'scene' in result && result.scene.updatedAt).toBe('2026-10-01T10:02:00.000Z');
    expect(await service.update('missing', living)).toBeNull();
  });

  it("stores each item's cloud anchor, and update replaces or drops them", async () => {
    const service = setup();
    const anchor = { cloudAnchorId: 'ua-123', expiresAt: '2027-10-13T00:00:00.000Z' };
    const withAnchor = { ...living, items: [{ ...living.items[0]!, anchor }, living.items[1]!] };
    const created = await service.create(withAnchor);
    expect(created).toMatchObject({ scene: { items: [{ productId: 'p-sofa', anchor }, { productId: 'p-rug' }] } });
    expect(created && 'scene' in created && created.scene.items[1]).not.toHaveProperty('anchor');
    const updated = await service.update('s-1', living);
    expect(updated && 'scene' in updated && updated.scene.items[0]).not.toHaveProperty('anchor');
  });

  it('deletes', async () => {
    const service = setup();
    await service.create(living);
    expect(await service.delete('s-1')).toBe(true);
    expect(await service.delete('s-1')).toBe(false);
    expect(await service.list()).toEqual([]);
  });
});
