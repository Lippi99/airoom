import type { Category, ClickEvent, Product, Retailer } from './entities';

export interface ProductFilter {
  categoryId?: string;
  /** Case-insensitive match on name and description. */
  search?: string;
  active?: boolean;
}

export interface ProductRepository {
  findAll(filter?: ProductFilter): Promise<Product[]>;
  findById(id: string): Promise<Product | null>;
}

export interface CategoryRepository {
  findAll(): Promise<Category[]>;
  findBySlug(slug: string): Promise<Category | null>;
}

export interface RetailerRepository {
  findById(id: string): Promise<Retailer | null>;
}

export interface ClickEventRepository {
  save(event: ClickEvent): Promise<void>;
  countByProduct(productId: string): Promise<number>;
}
