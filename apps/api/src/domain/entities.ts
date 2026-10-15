import type { Dimensions, FurnitureCategory, RecordedClickPlatform, ScenePose } from '@airoom/shared';

export interface Product {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  retailerId: string;
  price: number;
  currency: string;
  /** Real-world size in meters. */
  dimensions: Dimensions;
  thumbnailUrl: string;
  model: {
    glbUrl: string;
    usdzUrl: string;
    sizeBytes: number;
  };
  productUrl: string;
  affiliateUrl?: string;
  active: boolean;
}

export interface Category {
  id: string;
  slug: FurnitureCategory;
  name: string;
}

export interface Retailer {
  id: string;
  name: string;
  websiteUrl: string;
  affiliateProgram?: string;
}

export interface ClickEvent {
  id: string;
  productId: string;
  timestamp: Date;
  platform: RecordedClickPlatform;
  sessionId?: string;
}

/** A named arrangement of products saved from the AR view (see ScenePose in shared). */
export interface Scene {
  id: string;
  name: string;
  /** `items[0]` is the reference item: the others' poses are relative to it. */
  items: SceneItem[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SceneItem {
  productId: string;
  pose: ScenePose;
  /** Cloud anchor hosted at this item's own pose (see SceneAnchor in shared). */
  anchor?: { cloudAnchorId: string; expiresAt: Date };
}
