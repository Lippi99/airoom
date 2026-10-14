import { z } from 'zod';
import { CLICK_PLATFORMS, FURNITURE_CATEGORIES } from '@airoom/shared';

export const productListQuerySchema = z.object({
  category: z.enum(FURNITURE_CATEGORIES).optional(),
  search: z.string().trim().max(100).optional(),
});

export const idParamsSchema = z.object({
  id: z.string().min(1).max(100),
});

export const goParamsSchema = z.object({
  productId: z.string().min(1).max(100),
});

/**
 * Query of `/go/:productId`. Invalid values are dropped (`.catch(undefined)`) instead of
 * failing the request: the redirect must never be blocked by bad tracking data.
 */
export const goQuerySchema = z.object({
  platform: z.enum(CLICK_PLATFORMS).optional().catch(undefined),
  sessionId: z.string().trim().min(1).max(128).optional().catch(undefined),
});
