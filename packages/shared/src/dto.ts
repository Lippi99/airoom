import type { FurnitureCategory } from './categories';

/** Real-world size in meters. */
export interface Dimensions {
  width: number;
  depth: number;
  height: number;
}

export interface CategoryDto {
  id: string;
  slug: FurnitureCategory;
  name: string;
}

export interface RetailerSummaryDto {
  id: string;
  name: string;
}

export interface ProductModelDto {
  glbUrl: string;
  usdzUrl: string;
  sizeBytes: number;
}

/**
 * Product as returned by `/products` and `/products/:id`.
 * Retailer URLs are intentionally absent: the app must open `/go/:productId`.
 */
export interface ProductDto {
  id: string;
  name: string;
  description: string;
  category: CategoryDto;
  retailer: RetailerSummaryDto;
  price: number;
  currency: string;
  dimensions: Dimensions;
  thumbnailUrl: string;
  model: ProductModelDto;
}

export interface ProductListQuery {
  category?: FurnitureCategory;
  search?: string;
}

export interface ApiErrorDto {
  error: string;
  message: string;
}
