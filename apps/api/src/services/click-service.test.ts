import { describe, expect, it, vi } from 'vitest';
import type { ClickEvent } from '../domain/entities';
import type { ClickEventRepository } from '../domain/repositories';
import { InMemoryProductRepository } from '../repositories/in-memory/in-memory-product-repository';
import { productsFixture, silentLogger } from '../test/fixtures';
import { ClickService } from './click-service';

const NOW = new Date('2026-01-01T12:00:00Z');
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';

function setup(clicks?: ClickEventRepository, logger = silentLogger) {
  const saved: ClickEvent[] = [];
  const repo: ClickEventRepository = clicks ?? {
    save: async (e) => {
      saved.push(e);
    },
    countByProduct: async (id) => saved.filter((e) => e.productId === id).length,
  };
  const service = new ClickService(new InMemoryProductRepository(productsFixture), repo, logger, {
    now: () => NOW,
    newId: () => 'click-1',
  });
  return { service, saved };
}

describe('ClickService.trackAndResolve', () => {
  it('redirects to the affiliate URL when present', async () => {
    const { service } = setup();
    expect(await service.trackAndResolve({ productId: 'p-rug' })).toEqual({
      redirectUrl: 'https://two.example.com/p/p-rug?ref=airoom',
    });
  });

  it('falls back to the product URL', async () => {
    const { service } = setup();
    expect(await service.trackAndResolve({ productId: 'p-sofa' })).toEqual({
      redirectUrl: 'https://one.example.com/p/p-sofa',
    });
  });

  it('returns null for an unknown product and records nothing', async () => {
    const { service, saved } = setup();
    expect(await service.trackAndResolve({ productId: 'nope' })).toBeNull();
    expect(saved).toHaveLength(0);
  });

  it('still redirects for inactive products (old shared links keep earning)', async () => {
    const { service } = setup();
    expect(await service.trackAndResolve({ productId: 'p-inactive' })).not.toBeNull();
  });

  it('records the event with the reported platform and session', async () => {
    const { service, saved } = setup();
    await service.trackAndResolve({
      productId: 'p-sofa',
      platform: 'ios',
      sessionId: 's-1',
      userAgent: ANDROID_UA,
    });
    expect(saved).toEqual([
      { id: 'click-1', productId: 'p-sofa', timestamp: NOW, platform: 'ios', sessionId: 's-1' },
    ]);
  });

  it('infers the platform from the User-Agent when not reported', async () => {
    const { service, saved } = setup();
    await service.trackAndResolve({ productId: 'p-sofa', userAgent: ANDROID_UA });
    await service.trackAndResolve({ productId: 'p-sofa', userAgent: IPHONE_UA });
    expect(saved.map((e) => e.platform)).toEqual(['android', 'ios']);
  });

  it("records 'unknown' when the platform cannot be determined", async () => {
    const { service, saved } = setup();
    await service.trackAndResolve({ productId: 'p-sofa' });
    expect(saved[0]?.platform).toBe('unknown');
    expect(saved[0]).not.toHaveProperty('sessionId');
  });

  it('still redirects and logs when saving the click fails', async () => {
    const logger = { error: vi.fn() };
    const failing: ClickEventRepository = {
      save: async () => {
        throw new Error('storage down');
      },
      countByProduct: async () => 0,
    };
    const { service } = setup(failing, logger);
    expect(await service.trackAndResolve({ productId: 'p-sofa' })).toEqual({
      redirectUrl: 'https://one.example.com/p/p-sofa',
    });
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
