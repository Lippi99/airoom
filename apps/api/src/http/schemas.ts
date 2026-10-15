import { z } from 'zod';
import { CLICK_PLATFORMS, FURNITURE_CATEGORIES, SCENE_MAX_ITEMS, SCENE_NAME_MAX_LENGTH } from '@airoom/shared';

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

/** Offsets in meters within a room (generous bound), yaw in radians. */
const coordinate = z.number().finite().min(-100).max(100);

export const saveSceneSchema = z.object({
  name: z.string().trim().min(1).max(SCENE_NAME_MAX_LENGTH),
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(100),
        pose: z.object({ x: coordinate, y: coordinate, z: coordinate, yaw: z.number().finite().min(-10).max(10) }),
        anchor: z
          .object({
            cloudAnchorId: z.string().min(1).max(200),
            expiresAt: z.iso.datetime(),
          })
          .optional(),
      }),
    )
    .min(1)
    .max(SCENE_MAX_ITEMS),
});
