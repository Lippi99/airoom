import type { Dimensions, FurnitureCategory, RecordedClickPlatform } from '@airoom/shared';

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
