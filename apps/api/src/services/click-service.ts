import { randomUUID } from 'node:crypto';
import type { ClickPlatform, RecordedClickPlatform } from '@airoom/shared';
import type { ClickEventRepository, ProductRepository } from '../domain/repositories';
import type { Logger } from './logger';
import { inferPlatformFromUserAgent } from './platform';

export interface TrackClickInput {
  productId: string;
  /** Platform reported by the app. Already validated; undefined when missing or invalid. */
  platform?: ClickPlatform;
  sessionId?: string;
  userAgent?: string;
}

export interface ClickServiceDeps {
  now?: () => Date;
  newId?: () => string;
}

export class ClickService {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(
    private readonly products: ProductRepository,
    private readonly clicks: ClickEventRepository,
    private readonly logger: Logger,
    deps: ClickServiceDeps = {},
  ) {
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? randomUUID;
  }

  /**
   * Records the click and returns where to redirect, or null for an unknown product.
   * Tracking failures are logged and never block the redirect: a lost click costs money,
   * incomplete data does not.
   */
  async trackAndResolve(input: TrackClickInput): Promise<{ redirectUrl: string } | null> {
    const product = await this.products.findById(input.productId);
    if (!product) return null;

    const platform: RecordedClickPlatform =
      input.platform ?? inferPlatformFromUserAgent(input.userAgent);

    try {
      await this.clicks.save({
        id: this.newId(),
        productId: product.id,
        timestamp: this.now(),
        platform,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      });
    } catch (err) {
      this.logger.error({ err, productId: product.id }, 'Failed to record click event');
    }

    return { redirectUrl: product.affiliateUrl ?? product.productUrl };
  }
}
